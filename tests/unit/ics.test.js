import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { icsToEvents, normalizeUrl, assertSafeUrl } from '../../functions/ics.js';

const ics = readFileSync('tests/fixtures/icloud-sample.ics', 'utf8');
const NOW = Date.parse('2026-10-19T00:00:00+09:00');
const seoul = (s) => Date.parse(`${s}+09:00`);

describe('외부 캘린더(ICS) 변환', () => {
  const evs = icsToEvents(ics, { calendarId: 'ext1', now: NOW });
  const byTitle = (t) => evs.filter((e) => e.data.title === t);

  it('시간 일정: 시간대를 반영한 시각, 장소·설명', () => {
    const [e] = byTitle('저녁 약속');
    expect(e.data).toMatchObject({ allDay: false, startMs: seoul('2026-10-20T19:00:00'), endMs: seoul('2026-10-20T20:30:00'), location: '성수동', calendarId: 'ext1', createdBy: 'external', timeZone: 'Asia/Seoul' });
  });
  it('종일 여러 날 일정: 끝 날짜는 포함 기준(28~30일)', () => {
    expect(byTitle('제주 여행')[0].data).toMatchObject({ allDay: true, startDate: '2026-10-28', endDate: '2026-10-30' });
  });
  it('반복: 펼쳐 저장, 제외일(EXDATE) 빠짐, 개별 수정 회차 반영', () => {
    const gym = evs.filter((e) => e.data.title.startsWith('운동')).map((e) => [e.data.title, new Date(e.data.startMs).toISOString()]);
    // 10/5(월) 10/7(수,제외) 10/12(월,수정→9시) 10/14 10/19 10/21 = COUNT 6 중 제외 1
    expect(gym).toHaveLength(5);
    expect(gym).toContainEqual(['운동 (늦게)', new Date(seoul('2026-10-12T09:00:00')).toISOString()]);
    expect(gym.map((g) => g[1])).not.toContain(new Date(seoul('2026-10-07T07:00:00')).toISOString());
  });
  it('취소된 일정은 빼고, UTC 일정은 그대로', () => {
    expect(byTitle('취소된 일정')).toHaveLength(0);
    expect(byTitle('UTC 일정')[0].data.startMs).toBe(Date.parse('2026-10-16T01:00:00Z'));
  });
  it('같은 내용이면 같은 문서 ID·지문(fp) → 바뀐 것만 다시 쓴다', () => {
    const again = icsToEvents(ics, { calendarId: 'ext1', now: NOW });
    expect(again.map((e) => e.id + e.data.fp)).toEqual(evs.map((e) => e.id + e.data.fp));
    expect(new Set(evs.map((e) => e.id)).size).toBe(evs.length);
  });
  it('링크 검사: webcal → https, 내부망 주소 차단', () => {
    expect(normalizeUrl('webcal://p01-caldav.icloud.com/published/2/abc')).toBe('https://p01-caldav.icloud.com/published/2/abc');
    expect(() => assertSafeUrl('http://example.com/a.ics')).toThrow();
    expect(() => assertSafeUrl('https://127.0.0.1/a.ics')).toThrow();
    expect(() => assertSafeUrl('https://169.254.169.254/latest')).toThrow();
    expect(() => assertSafeUrl('https://localhost:9000/a.ics')).toThrow();
    expect(assertSafeUrl('https://p01-caldav.icloud.com/published/2/abc').hostname).toBe('p01-caldav.icloud.com');
  });
});
