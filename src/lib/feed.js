import { expandEvent } from './recurrence.js';
import { msToDate, safeZone, addDays, daysBetween } from './time.js';
import { eventColor, categoryOf } from './categories.js';

// 동시에 실시간으로 구독(onSnapshot)할 캘린더 수 상한. 캘린더당 쿼리 2개를 연다.
export const MAX_LIVE_CALENDARS = 20;

/**
 * 현재 화면에 표시할 캘린더(원본 데이터 출처) 목록을 계산한다.
 *  - focus === 'all' : 숨기지 않은 내 모든 캘린더 + 그 캘린더들에 대한 내 활성 구독의 원본
 *  - focus === calId : 그 캘린더 + 그 캘린더에 대한 내 활성 구독의 원본
 * 구독 원본이 내 캘린더 목록(= 현재 멤버인 캘린더)에 없으면 접근 권한이 없는 것이므로 표시하지 않는다.
 * 같은 원본은 한 번만 포함한다(같은 일정이 두 번 보이지 않음).
 */
export function resolveFeedSources({ calendars, subscriptions, focus, hiddenIds = [], max = MAX_LIVE_CALENDARS }) {
  const byId = new Map(calendars.map((c) => [c.id, c]));
  const hidden = new Set(hiddenIds);
  const targets = focus === 'all'
    ? calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id)
    : (byId.has(focus) ? [focus] : []);
  const targetSet = new Set(targets);
  const sources = new Map();
  for (const t of targets) sources.set(t, { calendarId: t, subscribed: false, via: null });

  const inaccessible = [];
  for (const s of subscriptions) {
    if (!s.active || !targetSet.has(s.targetCalendarId)) continue;
    if (!byId.has(s.sourceCalendarId)) { inaccessible.push(s); continue; }
    if (sources.has(s.sourceCalendarId)) continue;
    sources.set(s.sourceCalendarId, { calendarId: s.sourceCalendarId, subscribed: true, via: s.targetCalendarId });
  }
  const all = [...sources.values()];
  return { sources: all.slice(0, max), overflow: all.slice(max), inaccessible };
}

/** 구독 상태 표시용: 각 구독이 정상/접근 불가/일시중지 중 무엇인지 */
export function subscriptionStatus(sub, calendars) {
  if (!calendars.some((c) => c.id === sub.sourceCalendarId)) return 'no-access';
  return sub.active ? 'active' : 'paused';
}

/**
 * 원본 일정 문서들을 화면 범위의 표시용 인스턴스로 펼친다.
 * 각 인스턴스는 원본 calendarId/eventId 를 그대로 유지한다.
 */
export function buildInstances({ eventsByCal, sources, calendarsById, range, uid, tz, secrets = {}, search = '' }) {
  const zone = safeZone(tz);
  const out = [];
  const q = search.trim().toLowerCase();
  for (const src of sources) {
    const cal = calendarsById.get(src.calendarId);
    const evs = eventsByCal.get(src.calendarId);
    if (!cal || !evs) continue;
    for (const ev of evs) {
      const mine = ev.createdBy === uid;
      const secret = ev.visibility === 'busy' && mine ? secrets[`${src.calendarId}/${ev.id}`] : null;
      const title = ev.visibility === 'busy'
        ? (mine ? (secret?.title || '(시간만 공개)') : '바쁨')
        : (ev.title || '(제목 없음)');
      if (q) {
        const hay = [title, ev.location, ev.description, ev.notes, cal.name, secret?.location, secret?.description]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const base = {
        calendarId: src.calendarId,
        eventId: ev.id,
        ev,
        allDay: ev.allDay,
        subscribed: src.subscribed,
        via: src.via,
        calendarName: cal.name,
        // 누구 일정인지 (작성자 이름)
        ownerName: cal.memberInfo?.[ev.createdBy]?.name || '',
        color: eventColor(ev, cal, src.subscribed),
        calendarColor: cal.color,
        categoryName: categoryOf(cal, ev.category)?.name || '',
        hiddenDetails: ev.visibility === 'busy' && !mine,
        location: ev.visibility === 'busy' ? (secret?.location || '') : ev.location,
      };
      if (ev.kind === 'anniversary') out.push(...milestoneInstances(ev, base, title, range));
      for (const o of expandEvent(ev, range)) {
        const years = ev.kind === 'anniversary' && o.occKey ? Number(o.startDate.slice(0, 4)) - Number(ev.startDate.slice(0, 4)) : 0;
        const inst = {
          ...base,
          key: `${src.calendarId}/${ev.id}/${o.occKey ?? ''}`,
          occKey: o.occKey,
          // 기념일은 매년 "N주년"을 자동으로 붙인다(첫 해 당일은 제목 그대로)
          title: years > 0 ? `${title} ${years}주년` : title,
        };
        if (ev.allDay) {
          inst.startDate = o.startDate;
          inst.endDate = o.endDate;
          inst.sortMs = Date.parse(`${o.startDate}T00:00:00Z`);
        } else {
          inst.startMs = o.startMs;
          inst.endMs = o.endMs;
          inst.startDate = msToDate(o.startMs, zone);
          // 끝 시각이 자정 정각이면 전날까지로 표시
          inst.endDate = msToDate(Math.max(o.startMs, o.endMs - 1), zone);
          inst.sortMs = o.startMs;
        }
        out.push(inst);
      }
    }
  }
  out.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1
    : (b.allDay - a.allDay) || (a.sortMs - b.sortMs) || a.title.localeCompare(b.title)));
  return out;
}

/** 일정 아래 작은 글씨: 어느 캘린더의, 누구 일정인지 */
export function whoLabel(inst) {
  const name = inst.ownerName && inst.ownerName !== inst.calendarName ? inst.ownerName : '';
  return [inst.calendarName, name].filter(Boolean).join(' · ');
}

/**
 * 기념일의 100일 단위 날(100일, 200일 …)을 화면 범위 안에서 만든다. 시작한 날이 1일째.
 * 저장하지 않는 표시용 일정이며, 누르면 원래 기념일을 연다.
 */
export function milestoneInstances(ev, base, title, range) {
  if (ev.milestones === false || !ev.allDay || !ev.startDate) return [];
  const out = [];
  const first = Math.max(1, Math.ceil((daysBetween(ev.startDate, range.startDate) + 1) / 100));
  for (let k = first; k < first + 60; k++) {
    const n = k * 100;
    const date = addDays(ev.startDate, n - 1);
    if (date > range.endDate) break;
    if (date < range.startDate) continue;
    // 1년 단위 기념일과 같은 날이면 주년 표시를 우선한다
    if (date.slice(5) === ev.startDate.slice(5)) continue;
    out.push({
      ...base,
      key: `${base.calendarId}/${ev.id}/d${n}`,
      occKey: null,
      virtual: true,
      milestoneDays: n,
      title: `${title} ${n.toLocaleString('ko-KR')}일`,
      startDate: date,
      endDate: date,
      sortMs: Date.parse(`${date}T00:00:00Z`),
    });
  }
  return out;
}

/** 날짜별로 인스턴스를 나눈다 (여러 날 일정은 각 날짜에 포함) */
export function groupByDate(instances, startDate, endDate) {
  const map = new Map();
  for (const inst of instances) {
    let d = inst.startDate < startDate ? startDate : inst.startDate;
    const last = inst.endDate > endDate ? endDate : inst.endDate;
    let guard = 0;
    while (d <= last && guard++ < 400) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(inst);
      const dt = new Date(`${d}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      d = dt.toISOString().slice(0, 10);
    }
  }
  return map;
}

/**
 * 시간 일정이 겹칠 때 나란히 보이도록 열(column)을 배정한다.
 * 반환: Map(key → { col, cols })
 */
export function layoutOverlaps(items) {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const result = new Map();
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const colsEnd = [];
    for (const it of cluster) {
      let c = colsEnd.findIndex((end) => end <= it.top);
      if (c === -1) { c = colsEnd.length; colsEnd.push(it.bottom); } else colsEnd[c] = it.bottom;
      result.set(it.key, { col: c, cols: 0 });
    }
    for (const it of cluster) result.get(it.key).cols = colsEnd.length;
    cluster = [];
  };
  for (const it of sorted) {
    if (it.top >= clusterEnd && cluster.length) { flush(); clusterEnd = -Infinity; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  if (cluster.length) flush();
  return result;
}

/**
 * 월간 달력의 한 주(7일)에 일정 막대를 배치한다.
 * 여러 날 일정은 이어진 하나의 막대(제목 한 번)로, 겹치지 않도록 줄(lane)을 나눈다.
 * 반환: { bars: [{ inst, startCol, span, lane, contLeft, contRight }], hidden: [7개 칸별 숨은 개수] }
 */
export function layoutWeek(instances, weekDates, maxLanes) {
  const first = weekDates[0];
  const last = weekDates[weekDates.length - 1];
  const segs = [];
  for (const inst of instances) {
    if (inst.endDate < first || inst.startDate > last) continue;
    const s = inst.startDate < first ? first : inst.startDate;
    const e = inst.endDate > last ? last : inst.endDate;
    const startCol = weekDates.indexOf(s);
    const span = weekDates.indexOf(e) - startCol + 1;
    if (startCol < 0 || span < 1) continue;
    segs.push({ inst, startCol, span, contLeft: inst.startDate < first, contRight: inst.endDate > last });
  }
  // 먼저 시작하는 것, 긴 것, 종일 일정, 이른 시각 순으로 위쪽 줄에
  segs.sort((a, b) => a.startCol - b.startCol || b.span - a.span
    || (b.inst.allDay - a.inst.allDay) || (a.inst.sortMs - b.inst.sortMs));
  const laneEnds = [];
  const bars = [];
  const hidden = Array(weekDates.length).fill(0);
  for (const seg of segs) {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(-1); }
    laneEnds[lane] = seg.startCol + seg.span - 1;
    if (lane < maxLanes) bars.push({ ...seg, lane });
    else for (let c = seg.startCol; c < seg.startCol + seg.span; c++) hidden[c]++;
  }
  return { bars, hidden };
}
