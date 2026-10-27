import { DateTime } from 'luxon';

export const DEFAULT_TZ = 'Asia/Seoul';
// 반복 일정처럼 끝이 없는 일정의 조회 범위 끝 값 (약 서기 275000년)
export const FAR_FUTURE_MS = 8.64e15;

export const TIMEZONES = [
  'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Bangkok',
  'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Pacific/Honolulu', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

export function isValidZone(tz) {
  return typeof tz === 'string' && DateTime.now().setZone(tz).isValid;
}

export function safeZone(tz) {
  return isValidZone(tz) ? tz : DEFAULT_TZ;
}

/** 'YYYY-MM-DD' → 해당 날짜의 자정 DateTime (zone 기준) */
export function dateToDT(dateStr, tz) {
  return DateTime.fromISO(dateStr, { zone: safeZone(tz) }).startOf('day');
}

export function dtToDate(dt) {
  return dt.toISODate();
}

export function todayISO(tz) {
  return DateTime.now().setZone(safeZone(tz)).toISODate();
}

/** 두 날짜 문자열 사이의 달력상 일수 (b - a). 시간대/서머타임과 무관하게 정확하다. */
export function daysBetween(aDate, bDate) {
  const a = DateTime.fromISO(aDate, { zone: 'UTC' });
  const b = DateTime.fromISO(bDate, { zone: 'UTC' });
  return Math.round(b.diff(a, 'days').days);
}

export function addDays(dateStr, n) {
  return DateTime.fromISO(dateStr, { zone: 'UTC' }).plus({ days: n }).toISODate();
}

/**
 * 일정 데이터로부터 Firestore 범위 조회용 rangeStartMs/rangeEndMs 를 계산한다.
 * - 시간 일정: 실제 UTC 시각
 * - 종일 일정: 어느 시간대에서 보더라도 포함되도록 ±14시간 여유를 둔다.
 * - 반복 일정: until 이 없으면 끝을 FAR_FUTURE_MS 로 둔다.
 */
export function computeRange(ev) {
  let start;
  let end;
  if (ev.allDay) {
    start = Date.parse(`${ev.startDate}T00:00:00Z`) - 14 * 3600e3;
    end = Date.parse(`${addDays(ev.endDate, 1)}T00:00:00Z`) + 14 * 3600e3;
  } else {
    start = ev.startMs;
    end = ev.endMs;
  }
  const r = ev.recurrence;
  if (r) {
    if (r.until) {
      end = Math.max(end, Date.parse(`${addDays(r.until, 1)}T00:00:00Z`) + 14 * 3600e3
        + (ev.allDay ? daysBetween(ev.startDate, ev.endDate) * 86400e3 : (ev.endMs - ev.startMs)));
    } else {
      // count 로 끝나는 반복도 정확한 끝을 계산하기보다 넉넉하게 열어 둔다(표시 시 count 로 잘림).
      end = FAR_FUTURE_MS;
    }
  }
  return { rangeStartMs: start, rangeEndMs: end };
}

/** 보기 단위(month/week/day)와 기준 날짜로 화면 범위를 계산 */
export function viewRange(view, anchorDate, tz, weekStartsOn = 0) {
  const zone = safeZone(tz);
  const anchor = dateToDT(anchorDate, zone);
  const startOfWeek = (dt) => {
    // luxon weekday: 1(월)~7(일). weekStartsOn: 0(일) 또는 1(월)
    const wd = dt.weekday % 7; // 일=0
    const diff = (wd - weekStartsOn + 7) % 7;
    return dt.minus({ days: diff }).startOf('day');
  };
  let start;
  let end;
  if (view === 'month') {
    start = startOfWeek(anchor.startOf('month'));
    end = start.plus({ days: 42 });
  } else if (view === 'week') {
    start = startOfWeek(anchor);
    end = start.plus({ days: 7 });
  } else {
    start = anchor.startOf('day');
    end = start.plus({ days: 1 });
  }
  return {
    startDate: start.toISODate(),
    endDate: end.minus({ days: 1 }).toISODate(), // 포함
    startMs: start.toMillis(),
    endMs: end.toMillis(),
  };
}

export function formatTime(ms, tz) {
  return DateTime.fromMillis(ms, { zone: safeZone(tz) }).toFormat('HH:mm');
}

export function formatDateLabel(dateStr, tz) {
  return dateToDT(dateStr, tz).setLocale('ko').toFormat('M월 d일 (ccc)');
}

export function msToLocalInput(ms, tz) {
  return DateTime.fromMillis(ms, { zone: safeZone(tz) }).toFormat("yyyy-MM-dd'T'HH:mm");
}

export function localInputToMs(value, tz) {
  return DateTime.fromISO(value, { zone: safeZone(tz) }).toMillis();
}

export function msToDate(ms, tz) {
  return DateTime.fromMillis(ms, { zone: safeZone(tz) }).toISODate();
}
