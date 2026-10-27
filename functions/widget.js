// 아이폰 홈 화면 위젯용 일정 피드. 위젯은 로그인할 수 없으므로, 앱이 만들어 둔 비밀 토큰으로 사용자를 찾는다.
// 앱 화면과 똑같은 계산(src/lib → shared/)으로 앞으로 14일 일정과 D-day 를 만든다.
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { resolveFeedSources, buildInstances, groupByDate } from './shared/feed.js';
import { safeZone, addDays, daysBetween } from './shared/time.js';
import { eventColor } from './shared/categories.js';
import { ddayLabel, dayCountSince, nextYearly, nextHundredMilestone } from './shared/dday.js';

export const WIDGET_DAYS = 14;
const HOLIDAYS = JSON.parse(readFileSync(new URL('./shared/holidays-data.json', import.meta.url), 'utf8'));
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

const fmtTime = (ms, zone) => DateTime.fromMillis(ms, { zone }).toFormat('HH:mm');
const holidayOf = (date) => HOLIDAYS[date.slice(0, 4)]?.[date]?.[0] || null;

async function eventsOf(db, calId, uid, range) {
  const col = db.collection(`calendars/${calId}/events`);
  const inRange = (q) => q.where('rangeStartMs', '<=', range.endMs).where('rangeEndMs', '>=', range.startMs);
  // 앱과 같은 두 쿼리: 멤버에게 보이는 일정 + 내 비공개 일정 (다른 사람의 비공개 일정은 서버에서도 빼고 보낸다)
  const [shared, mine] = await Promise.all([
    inRange(col.where('visibility', 'in', ['members', 'busy'])).get(),
    inRange(col.where('createdBy', '==', uid).where('visibility', '==', 'private')).get(),
  ]);
  return [...shared.docs, ...mine.docs].map((d) => ({ id: d.id, ...d.data() }));
}

function toItem(inst, date, zone) {
  const item = {
    title: inst.title,
    allDay: Boolean(inst.allDay),
    color: inst.color || inst.calendarColor || '#e88aa6',
    done: Boolean(inst.done),
    calendar: inst.calendarName || '',
  };
  if (!inst.allDay) {
    // 여러 날에 걸친 시간 일정: 시작한 날에만 시작 시각, 나머지 날은 "계속"
    item.time = inst.startDate === date ? fmtTime(inst.startMs, zone) : '';
    item.endTime = inst.endDate === date ? fmtTime(inst.endMs, zone) : '';
  }
  if (inst.startDate !== inst.endDate) item.span = `${daysBetween(inst.startDate, date) + 1}/${daysBetween(inst.startDate, inst.endDate) + 1}`;
  return item;
}

/** 기념일과 "D-day 표시" 일정을 가까운 순서로 */
function ddaysOf(events, today, rangeEnd) {
  const out = [];
  for (const { ev, color } of events) {
    if (ev.visibility === 'busy') continue;
    if (ev.kind === 'anniversary' && ev.startDate && ev.allDay) {
      const passed = ev.startDate <= today;
      const yearly = nextYearly(ev.startDate, today);
      const hundred = passed && ev.milestones !== false ? nextHundredMilestone(ev.startDate, today) : null;
      const next = hundred && hundred.date < yearly.date
        ? { date: hundred.date, label: `${hundred.days.toLocaleString('ko-KR')}일 ${ddayLabel(hundred.date, today)}` }
        : { date: yearly.date, label: `${yearly.years}주년 ${ddayLabel(yearly.date, today)}` };
      out.push({ title: ev.title || '기념일', color, count: passed ? `${dayCountSince(ev.startDate, today).toLocaleString('ko-KR')}일째` : ddayLabel(ev.startDate, today), next: next.label, date: next.date });
    } else if (ev.showDday && !ev.recurrence) {
      const date = ev.allDay ? ev.startDate : null;
      if (date && date >= today && date <= rangeEnd) out.push({ title: ev.title || '일정', color, count: ddayLabel(date, today), next: '', date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 4);
}

/** 사용자 한 명의 위젯 데이터 */
export async function buildWidgetFeed(db, uid, calendarId, now = Date.now()) {
  const user = (await db.doc(`users/${uid}`).get()).data() || {};
  const tz = safeZone(user.settings?.timeZone);
  const [calSnap, subSnap] = await Promise.all([
    db.collection('calendars').where('memberIds', 'array-contains', uid).get(),
    db.collection('subscriptions').where('ownerUid', '==', uid).get(),
  ]);
  const calendars = calSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const subscriptions = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const calendarsById = new Map(calendars.map((c) => [c.id, c]));
  // 앱에서 보고 있던 캘린더(없으면 내가 만든 첫 캘린더)를 위젯에 보여 준다
  const focusCal = calendarsById.get(calendarId)
    || calendars.filter((c) => c.ownerId === uid && !c.external).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))[0]
    || calendars[0];

  const today = DateTime.fromMillis(now, { zone: tz }).toISODate();
  const endDate = addDays(today, WIDGET_DAYS - 1);
  const range = {
    startDate: today,
    endDate,
    startMs: DateTime.fromISO(today, { zone: tz }).toMillis(),
    endMs: DateTime.fromISO(addDays(endDate, 1), { zone: tz }).toMillis(),
  };
  const base = { generatedAt: new Date(now).toISOString(), timeZone: tz, today };
  if (!focusCal) return { ...base, calendar: null, days: [], ddays: [] };

  const { sources } = resolveFeedSources({ calendars, subscriptions, focus: focusCal.id, hiddenIds: [] });
  const eventsByCal = new Map();
  const secrets = {};
  await Promise.all(sources.map(async (s) => {
    const evs = await eventsOf(db, s.calendarId, uid, range);
    eventsByCal.set(s.calendarId, evs);
    // 내가 "시간만 공개"로 쓴 일정은 나에게는 제목을 보여 준다
    await Promise.all(evs.filter((e) => e.visibility === 'busy' && e.createdBy === uid).map(async (e) => {
      const sec = await db.doc(`calendars/${s.calendarId}/events/${e.id}/secret/detail`).get();
      if (sec.exists) secrets[`${s.calendarId}/${e.id}`] = sec.data();
    }));
  }));

  const instances = buildInstances({ eventsByCal, sources, calendarsById, range, uid, tz, secrets });
  const byDate = groupByDate(instances, range.startDate, range.endDate);
  const days = [];
  for (let d = today; d <= endDate; d = addDays(d, 1)) {
    const list = byDate.get(d) || [];
    days.push({ date: d, holiday: holidayOf(d), items: list.slice(0, 12).map((i) => toItem(i, d, tz)), more: Math.max(0, list.length - 12) });
  }
  const ddayEvents = [];
  for (const s of sources) {
    const cal = calendarsById.get(s.calendarId);
    for (const ev of eventsByCal.get(s.calendarId) || []) {
      if (ev.kind === 'anniversary' || ev.showDday) {
        ddayEvents.push({ ev, color: s.subscribed && s.color ? s.color : (eventColor(ev, cal, s.subscribed) || '#e88aa6') });
      }
    }
  }
  return {
    ...base,
    calendar: { name: focusCal.name, color: focusCal.color || '#e88aa6' },
    days,
    ddays: ddaysOf(ddayEvents, today, endDate),
  };
}
