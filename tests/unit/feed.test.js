import { describe, it, expect } from 'vitest';
import { resolveFeedSources, buildInstances, layoutOverlaps, groupByDate, subscriptionStatus } from '../../src/lib/feed.js';
import { viewRange } from '../../src/lib/time.js';

const cals = [
  { id: 'personal', name: '개인', color: '#111' },
  { id: 'family', name: '가족', color: '#222' },
  { id: 'couple', name: '커플', color: '#333' },
];
const sub = (target, source, active = true) => ({ id: `u__${target}__${source}`, targetCalendarId: target, sourceCalendarId: source, active });

describe('resolveFeedSources', () => {
  it('특정 캘린더 보기: 자체 일정 + 구독 원본', () => {
    const r = resolveFeedSources({ calendars: cals, subscriptions: [sub('couple', 'family')], focus: 'couple' });
    expect(r.sources).toEqual([
      { calendarId: 'couple', subscribed: false, via: null },
      { calendarId: 'family', subscribed: true, via: 'couple' },
    ]);
  });
  it('일시중지된 구독/다른 대상 구독은 제외', () => {
    const r = resolveFeedSources({ calendars: cals, subscriptions: [sub('couple', 'family', false), sub('personal', 'family')], focus: 'couple' });
    expect(r.sources.map((s) => s.calendarId)).toEqual(['couple']);
  });
  it('접근 권한이 사라진 원본은 표시하지 않고 inaccessible 로 보고', () => {
    const r = resolveFeedSources({ calendars: cals, subscriptions: [sub('couple', 'gone')], focus: 'couple' });
    expect(r.sources.map((s) => s.calendarId)).toEqual(['couple']);
    expect(r.inaccessible).toHaveLength(1);
    expect(subscriptionStatus(sub('couple', 'gone'), cals)).toBe('no-access');
  });
  it('통합 보기: 숨긴 캘린더 제외, 이미 표시 중인 원본은 중복 없음', () => {
    const r = resolveFeedSources({ calendars: cals, subscriptions: [sub('couple', 'family')], focus: 'all', hiddenIds: ['personal'] });
    expect(r.sources).toEqual([
      { calendarId: 'family', subscribed: false, via: null },
      { calendarId: 'couple', subscribed: false, via: null },
    ]);
    const r2 = resolveFeedSources({ calendars: cals, subscriptions: [sub('couple', 'family')], focus: 'all', hiddenIds: ['family'] });
    expect(r2.sources.find((s) => s.calendarId === 'family')).toEqual({ calendarId: 'family', subscribed: true, via: 'couple' });
  });
  it('리스너 수 상한', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `c${i}`, color: '#000' }));
    const r = resolveFeedSources({ calendars: many, subscriptions: [], focus: 'all', max: 20 });
    expect(r.sources).toHaveLength(20);
    expect(r.overflow).toHaveLength(10);
  });
});

describe('buildInstances', () => {
  const range = viewRange('month', '2026-10-01', 'Asia/Seoul', 0);
  const base = { allDay: true, startDate: '2026-10-20', endDate: '2026-10-20', timeZone: 'Asia/Seoul', exdates: [], recurrence: null };
  it('원본 ID 유지, 구독 표시, 시간만 공개 제목 숨김, 검색', () => {
    const eventsByCal = new Map([
      ['couple', [{ ...base, id: 'e1', title: '데이트', visibility: 'members', createdBy: 'a' }]],
      ['family', [{ ...base, id: 'e2', title: '', visibility: 'busy', createdBy: 'b' }]],
    ]);
    const calendarsById = new Map(cals.map((c) => [c.id, c]));
    const sources = [{ calendarId: 'couple', subscribed: false, via: null }, { calendarId: 'family', subscribed: true, via: 'couple' }];
    const inst = buildInstances({ eventsByCal, sources, calendarsById, range, uid: 'a', tz: 'Asia/Seoul' });
    expect(inst.map((i) => [i.calendarId, i.eventId, i.title, i.subscribed])).toEqual([
      ['family', 'e2', '바쁨', true],
      ['couple', 'e1', '데이트', false],
    ].sort((x, y) => x[2].localeCompare(y[2])));
    const found = buildInstances({ eventsByCal, sources, calendarsById, range, uid: 'a', tz: 'Asia/Seoul', search: '데이' });
    expect(found.map((i) => i.eventId)).toEqual(['e1']);
  });
});

describe('layout', () => {
  it('겹치는 일정은 열을 나눔', () => {
    const m = layoutOverlaps([
      { key: 'a', top: 0, bottom: 60 }, { key: 'b', top: 30, bottom: 90 }, { key: 'c', top: 100, bottom: 120 },
    ]);
    expect(m.get('a')).toEqual({ col: 0, cols: 2 });
    expect(m.get('b')).toEqual({ col: 1, cols: 2 });
    expect(m.get('c')).toEqual({ col: 0, cols: 1 });
  });
  it('여러 날 일정을 날짜별로', () => {
    const g = groupByDate([{ startDate: '2026-10-30', endDate: '2026-11-02' }], '2026-10-01', '2026-10-31');
    expect([...g.keys()]).toEqual(['2026-10-30', '2026-10-31']);
  });
});

import { holidayOf, holidayFullName, specialDayOf } from '../../src/lib/holidays.js';
describe('공휴일 (자동 데이터 사본)', () => {
  it('레퍼런스 달력(2026년 10월)과 일치하고 짧은 이름으로 표시', () => {
    expect(holidayOf('2026-10-03')).toBe('개천절');
    expect(holidayOf('2026-10-05')).toBe('대체휴일');
    expect(holidayOf('2026-10-09')).toBe('한글날');
    expect(holidayOf('2026-10-10')).toBeNull();
    expect(holidayOf('2026-12-25')).toBe('성탄절');
    expect(holidayFullName('2026-10-05')).toBe('대체공휴일(개천절)');
    expect(specialDayOf('2026-10-31')).toBe('할로윈');
  });
  it('직접 만든 표에서 빠졌던 공휴일과 2027년 명절 포함', () => {
    expect(holidayOf('2026-05-01')).toBe('노동절');
    expect(holidayOf('2026-07-17')).toBe('제헌절');
    expect(holidayOf('2027-02-07')).toBe('설날');
    expect(holidayOf('2027-02-09')).toBe('대체휴일');
  });
});

import { milestoneInstances } from '../../src/lib/feed.js';
import { eventColor, DEFAULT_CATEGORIES } from '../../src/lib/categories.js';
describe('기념일 자동 계산과 분류 색', () => {
  const anniv = { id: 'a', title: '사귄 날', kind: 'anniversary', allDay: true, startDate: '2026-01-01', endDate: '2026-01-01', recurrence: { freq: 'YEARLY', interval: 1 }, exdates: [], timeZone: 'Asia/Seoul', visibility: 'members', createdBy: 'u', milestones: true };
  it('100일 단위 표시 (시작일이 1일째)', () => {
    const r = viewRange('month', '2026-04-01', 'Asia/Seoul', 0);
    const m = milestoneInstances(anniv, { calendarId: 'c' }, '사귄 날', r);
    expect(m.map((i) => [i.startDate, i.title])).toEqual([['2026-04-10', '사귄 날 100일']]);
    expect(milestoneInstances({ ...anniv, milestones: false }, { calendarId: 'c' }, 'x', r)).toEqual([]);
  });
  it('매년 N주년 제목', () => {
    const cal = { id: 'c', name: '커플', color: '#111', memberInfo: { u: { name: '지수' } } };
    const inst = buildInstances({ eventsByCal: new Map([['c', [anniv]]]), sources: [{ calendarId: 'c', subscribed: false }], calendarsById: new Map([['c', cal]]), range: viewRange('month', '2028-01-01', 'Asia/Seoul', 0), uid: 'u', tz: 'Asia/Seoul' });
    expect(inst.find((i) => i.startDate === '2028-01-01').title).toBe('사귄 날 2주년');
    expect(inst[0].ownerName).toBe('지수');
  });
  it('분류 색, 구독 일정은 원본 캘린더 색 고정', () => {
    const cal = { color: '#123456', categories: DEFAULT_CATEGORIES };
    expect(eventColor({ category: 'hospital' }, cal)).toBe('#e4513a');
    expect(eventColor({ category: 'hospital' }, cal, true)).toBe('#123456');
    expect(eventColor({ category: '' }, cal)).toBe('#123456');
  });
});
