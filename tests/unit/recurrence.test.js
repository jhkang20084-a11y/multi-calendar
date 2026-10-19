import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { expandEvent, describeRecurrence, untilBefore } from '../../src/lib/recurrence.js';
import { computeRange, viewRange, daysBetween, FAR_FUTURE_MS } from '../../src/lib/time.js';
import { ddayLabel, dayCountSince, nextYearly, nextHundredMilestone } from '../../src/lib/dday.js';

const seoul = (iso) => DateTime.fromISO(iso, { zone: 'Asia/Seoul' }).toMillis();
const rangeOf = (view, date) => viewRange(view, date, 'Asia/Seoul', 0);

describe('expandEvent', () => {
  it('단일 시간 일정은 범위와 겹칠 때만 반환', () => {
    const ev = { allDay: false, startMs: seoul('2026-10-20T10:00'), endMs: seoul('2026-10-20T11:00'), timeZone: 'Asia/Seoul' };
    expect(expandEvent(ev, rangeOf('day', '2026-10-20'))).toHaveLength(1);
    expect(expandEvent(ev, rangeOf('day', '2026-10-21'))).toHaveLength(0);
  });

  it('여러 날 종일 일정이 범위에 걸치면 반환', () => {
    const ev = { allDay: true, startDate: '2026-10-18', endDate: '2026-10-22', timeZone: 'Asia/Seoul' };
    expect(expandEvent(ev, rangeOf('day', '2026-10-20'))).toEqual([{ occKey: null, startDate: '2026-10-18', endDate: '2026-10-22' }]);
  });

  it('매주 월·수 반복 + exdate 제외', () => {
    const ev = {
      allDay: false, timeZone: 'Asia/Seoul',
      startMs: seoul('2026-10-05T09:00'), endMs: seoul('2026-10-05T10:00'),
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [1, 3] },
      exdates: [String(seoul('2026-10-14T09:00'))],
    };
    const occ = expandEvent(ev, rangeOf('month', '2026-10-01'));
    const days = occ.map((o) => DateTime.fromMillis(o.startMs, { zone: 'Asia/Seoul' }).toISODate());
    expect(days).toContain('2026-10-05');
    expect(days).toContain('2026-10-07');
    expect(days).toContain('2026-10-12');
    expect(days).not.toContain('2026-10-14');
    expect(days.every((d) => d >= '2026-10-05')).toBe(true);
  });

  it('count 와 until 제한', () => {
    const base = { allDay: true, startDate: '2026-10-01', endDate: '2026-10-01', timeZone: 'Asia/Seoul' };
    const r = rangeOf('month', '2026-10-01');
    expect(expandEvent({ ...base, recurrence: { freq: 'DAILY', interval: 1, count: 3 } }, r)).toHaveLength(3);
    expect(expandEvent({ ...base, recurrence: { freq: 'DAILY', interval: 2, until: '2026-10-09' } }, r)
      .map((o) => o.startDate)).toEqual(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09']);
  });

  it('오래전에 시작한 매일 반복도 빠르게 계산', () => {
    const ev = { allDay: false, timeZone: 'Asia/Seoul', startMs: seoul('2000-01-01T07:00'), endMs: seoul('2000-01-01T07:30'), recurrence: { freq: 'DAILY', interval: 1 } };
    const occ = expandEvent(ev, rangeOf('week', '2026-10-19'));
    expect(occ).toHaveLength(7);
  });

  it('매월 31일 반복은 31일이 없는 달을 건너뜀', () => {
    const ev = { allDay: true, startDate: '2026-01-31', endDate: '2026-01-31', timeZone: 'Asia/Seoul', recurrence: { freq: 'MONTHLY', interval: 1 } };
    expect(expandEvent(ev, rangeOf('month', '2026-02-01')).map((o) => o.startDate)).toEqual([]); // 2월에는 31일이 없음
    expect(expandEvent(ev, rangeOf('month', '2026-03-01')).map((o) => o.startDate)).toEqual(['2026-03-31']);
  });

  it('매년 반복(기념일), 2/29 은 평년에 2/28', () => {
    const ev = { allDay: true, startDate: '2024-02-29', endDate: '2024-02-29', timeZone: 'Asia/Seoul', recurrence: { freq: 'YEARLY', interval: 1 } };
    expect(expandEvent(ev, rangeOf('month', '2027-02-01')).map((o) => o.startDate)).toEqual(['2027-02-28']);
  });

  it('서머타임 지역에서도 현지 시각을 유지', () => {
    const ny = (iso) => DateTime.fromISO(iso, { zone: 'America/New_York' }).toMillis();
    const ev = { allDay: false, timeZone: 'America/New_York', startMs: ny('2026-10-26T09:00'), endMs: ny('2026-10-26T10:00'), recurrence: { freq: 'WEEKLY', interval: 1 } };
    const r = viewRange('month', '2026-11-01', 'America/New_York', 0);
    const hours = expandEvent(ev, r).map((o) => DateTime.fromMillis(o.startMs, { zone: 'America/New_York' }).hour);
    expect(hours.length).toBeGreaterThan(3);
    expect(new Set(hours)).toEqual(new Set([9]));
  });

  it('describe / untilBefore', () => {
    expect(describeRecurrence({ freq: 'WEEKLY', interval: 2, byWeekday: [3, 1] })).toBe('2주마다 월·수요일');
    const ev = { allDay: true, startDate: '2026-10-01', endDate: '2026-10-01' };
    expect(untilBefore(ev, '2026-10-10')).toBe('2026-10-09');
  });
});

describe('computeRange', () => {
  it('반복 일정(until 없음)은 끝이 FAR_FUTURE', () => {
    const r = computeRange({ allDay: true, startDate: '2026-10-01', endDate: '2026-10-01', recurrence: { freq: 'YEARLY' } });
    expect(r.rangeEndMs).toBe(FAR_FUTURE_MS);
  });
  it('종일 일정은 모든 시간대를 포함하도록 여유', () => {
    const r = computeRange({ allDay: true, startDate: '2026-10-01', endDate: '2026-10-01' });
    expect(r.rangeStartMs).toBeLessThan(Date.parse('2026-10-01T00:00:00Z'));
    expect(r.rangeEndMs).toBeGreaterThan(Date.parse('2026-10-02T00:00:00Z'));
  });
});

describe('D-day', () => {
  it('라벨과 경과일', () => {
    expect(ddayLabel('2026-10-22', '2026-10-19')).toBe('D-3');
    expect(ddayLabel('2026-10-19', '2026-10-19')).toBe('D-Day');
    expect(ddayLabel('2026-10-17', '2026-10-19')).toBe('D+2');
    expect(dayCountSince('2026-10-19', '2026-10-19')).toBe(1);
    expect(dayCountSince('2026-01-01', '2026-04-10')).toBe(100);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
  it('다음 연례 기념일 / 100일 단위', () => {
    expect(nextYearly('2020-10-25', '2026-10-19')).toEqual({ date: '2026-10-25', years: 6 });
    expect(nextYearly('2020-10-01', '2026-10-19')).toEqual({ date: '2027-10-01', years: 7 });
    expect(nextHundredMilestone('2026-01-01', '2026-02-01')).toEqual({ days: 100, date: '2026-04-10' });
  });
});
