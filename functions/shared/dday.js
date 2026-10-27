import { DateTime } from 'luxon';
import { daysBetween, safeZone } from './time.js';

/**
 * D-day 계산. 모든 계산은 "달력 날짜" 기준이므로 시간대·서머타임에 따라 하루가 어긋나지 않는다.
 * today 는 사용자의 시간대(기본 Asia/Seoul) 기준 오늘 날짜('YYYY-MM-DD').
 */

/** 목표일까지 남은 일수 표시: D-3, D-Day, D+5 */
export function ddayLabel(targetDate, today) {
  const diff = daysBetween(today, targetDate);
  if (diff === 0) return 'D-Day';
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/** 시작일을 1일째로 세는 경과 일수 (커플 기념일 방식: 시작한 날 = 1일) */
export function dayCountSince(startDate, today) {
  return daysBetween(startDate, today) + 1;
}

/** 다음 연례 기념일 날짜. 2월 29일은 평년에 2월 28일로 처리한다. */
export function nextYearly(startDate, today) {
  const s = DateTime.fromISO(startDate, { zone: 'UTC' });
  const t = DateTime.fromISO(today, { zone: 'UTC' });
  let years = Math.max(0, t.year - s.year);
  let cand = s.plus({ years });
  if (cand < t) cand = s.plus({ years: years + 1 });
  return { date: cand.toISODate(), years: Math.round(cand.diff(s, 'years').years) };
}

/** 다음 100일 단위 기념일 (예: 100일, 200일 …). 시작일이 1일째. */
export function nextHundredMilestone(startDate, today) {
  const count = dayCountSince(startDate, today);
  if (count < 1) return null;
  const next = Math.ceil(count / 100) * 100;
  const date = DateTime.fromISO(startDate, { zone: 'UTC' }).plus({ days: next - 1 }).toISODate();
  return { days: next, date };
}

/** 기념일 일정 하나에 대한 요약 */
export function anniversarySummary(ev, tz) {
  const today = DateTime.now().setZone(safeZone(tz)).toISODate();
  const start = ev.startDate;
  const passed = start <= today;
  const yearly = nextYearly(start, today);
  return {
    today,
    passed,
    countLabel: passed ? `${dayCountSince(start, today)}일째` : ddayLabel(start, today),
    nextYearly: yearly,
    nextYearlyLabel: ddayLabel(yearly.date, today),
    milestone: passed ? nextHundredMilestone(start, today) : null,
  };
}
