import { DateTime } from 'luxon';
import { safeZone, daysBetween, addDays } from './time.js';

/**
 * 반복 규칙 형식 (Firestore events.recurrence)
 *   { freq: 'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY', interval: 1, byWeekday?: [1..7], until?: 'YYYY-MM-DD', count?: n }
 *   byWeekday 는 luxon 요일(1=월 … 7=일). until 은 일정 시간대 기준 날짜(포함).
 * 특정 회차 제외: events.exdates = [occKey...]
 *   occKey: 종일 일정은 'YYYY-MM-DD', 시간 일정은 원래 시작 시각의 UTC 밀리초 문자열
 * 특정 회차 수정: 별도 일정 문서(recurringEventId=원본 ID, originalStart=occKey)를 만들고
 *   원본의 exdates 에 occKey 를 추가한다.
 */

export const FREQ_LABELS = {
  DAILY: '매일',
  WEEKLY: '매주',
  MONTHLY: '매월',
  YEARLY: '매년',
};

const WEEKDAY_KO = ['', '월', '화', '수', '목', '금', '토', '일'];
const MAX_ITER = 5000;

export function describeRecurrence(r) {
  if (!r) return '';
  const n = r.interval && r.interval > 1 ? r.interval : 1;
  const unit = { DAILY: '일', WEEKLY: '주', MONTHLY: '개월', YEARLY: '년' }[r.freq];
  let s = n === 1 ? FREQ_LABELS[r.freq] : `${n}${unit}마다`;
  if (r.freq === 'WEEKLY' && r.byWeekday?.length) {
    s += ` ${[...r.byWeekday].sort().map((d) => WEEKDAY_KO[d]).join('·')}요일`;
  }
  if (r.until) s += `, ${r.until}까지`;
  else if (r.count) s += `, ${r.count}회`;
  return s;
}

function baseOf(ev) {
  if (ev.allDay) return DateTime.fromISO(ev.startDate, { zone: 'UTC' });
  return DateTime.fromMillis(ev.startMs, { zone: safeZone(ev.timeZone) });
}

export function occKeyOf(ev, dt) {
  return ev.allDay ? dt.toISODate() : String(dt.toMillis());
}

/** 반복 후보 시작 시각을 순서대로 생성한다. */
function* candidates(base, r, skipPeriods) {
  const interval = Math.max(1, Math.floor(r.interval || 1));
  if (r.freq === 'DAILY') {
    for (let k = skipPeriods; ; k++) yield base.plus({ days: k * interval });
  } else if (r.freq === 'WEEKLY') {
    const days = (r.byWeekday?.length ? [...new Set(r.byWeekday)] : [base.weekday]).sort((a, b) => a - b);
    const weekStart = base.minus({ days: base.weekday - 1 });
    for (let w = skipPeriods; ; w++) {
      const ws = weekStart.plus({ weeks: w * interval });
      for (const d of days) {
        const dt = ws.plus({ days: d - 1 });
        if (dt < base) continue;
        yield dt;
      }
    }
  } else if (r.freq === 'MONTHLY') {
    for (let k = skipPeriods; ; k++) {
      const dt = base.plus({ months: k * interval });
      if (dt.day !== base.day) continue; // 31일이 없는 달은 건너뜀
      yield dt;
    }
  } else if (r.freq === 'YEARLY') {
    // 2월 29일 기념일은 평년에는 2월 28일로 표시된다(luxon 의 월말 보정).
    for (let k = skipPeriods; ; k++) yield base.plus({ years: k * interval });
  }
}

const MAX_PERIOD_DAYS = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 };

/**
 * 하나의 일정 문서를 화면 범위 안의 회차들로 펼친다.
 * range: { startMs, endMs, startDate, endDate(포함) }
 * 반환: [{ occKey|null, startMs, endMs } | { occKey|null, startDate, endDate }]
 */
export function expandEvent(ev, range) {
  const overlaps = (o) => (ev.allDay
    ? o.startDate <= range.endDate && o.endDate >= range.startDate
    : o.startMs < range.endMs && o.endMs > range.startMs);

  if (!ev.recurrence) {
    const o = ev.allDay
      ? { occKey: null, startDate: ev.startDate, endDate: ev.endDate }
      : { occKey: null, startMs: ev.startMs, endMs: ev.endMs };
    return overlaps(o) ? [o] : [];
  }

  const r = ev.recurrence;
  if (!MAX_PERIOD_DAYS[r.freq]) return [];
  const base = baseOf(ev);
  const durDays = ev.allDay ? daysBetween(ev.startDate, ev.endDate) : 0;
  const durMs = ev.allDay ? 0 : ev.endMs - ev.startMs;
  const ex = new Set(ev.exdates || []);
  const interval = Math.max(1, Math.floor(r.interval || 1));

  // count 가 없으면 범위 직전까지 안전하게 건너뛴다(오래전 시작한 매일 반복 등).
  let skip = 0;
  if (!r.count) {
    const rangeStartMs = ev.allDay ? Date.parse(`${range.startDate}T00:00:00Z`) : range.startMs;
    const gapDays = (rangeStartMs - base.toMillis() - durMs) / 86400e3 - durDays;
    skip = Math.max(0, Math.floor(gapDays / (MAX_PERIOD_DAYS[r.freq] * interval)) - 1);
  }

  const out = [];
  let index = 0;
  let iter = 0;
  for (const dt of candidates(base, r, skip)) {
    if (++iter > MAX_ITER) break;
    const startLocalDate = dt.toISODate();
    if (r.until && startLocalDate > r.until) break;
    if (r.count && index >= r.count) break;
    index++;
    const o = ev.allDay
      ? { startDate: startLocalDate, endDate: addDays(startLocalDate, durDays) }
      : { startMs: dt.toMillis(), endMs: dt.toMillis() + durMs };
    if (ev.allDay ? o.startDate > range.endDate : o.startMs >= range.endMs) break;
    const key = occKeyOf(ev, dt);
    if (ex.has(key)) continue;
    if (overlaps(o)) out.push({ occKey: key, ...o });
  }
  return out;
}

/** 특정 회차의 원래 시작을 DateTime 으로 (occKey → DateTime) */
export function occKeyToDT(ev, occKey) {
  if (ev.allDay) return DateTime.fromISO(occKey, { zone: 'UTC' });
  return DateTime.fromMillis(Number(occKey), { zone: safeZone(ev.timeZone) });
}

/** "이후 모든 회차" 분할 시 기존 반복을 끝낼 날짜(occKey 바로 전날, 일정 시간대 기준) */
export function untilBefore(ev, occKey) {
  return occKeyToDT(ev, occKey).minus({ days: 1 }).toISODate();
}
