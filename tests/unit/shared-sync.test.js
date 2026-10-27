// 서버 함수(functions/shared)가 앱(src/lib)과 같은 일정 계산 코드를 쓰는지 확인한다.
// 실패하면: node functions/scripts/sync-shared.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = ['feed.js', 'recurrence.js', 'time.js', 'categories.js', 'dday.js', 'holidays-data.json'];

describe('서버와 앱의 일정 계산 코드', () => {
  it.each(FILES)('%s 가 같음', (f) => {
    expect(readFileSync(`functions/shared/${f}`, 'utf8')).toBe(readFileSync(`src/lib/${f}`, 'utf8'));
  });
});
