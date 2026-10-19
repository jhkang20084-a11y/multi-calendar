// 앱에 함께 넣는 공휴일 사본(src/lib/holidays-data.json)을 최신으로 갱신한다.
// 출처: https://github.com/hyunbinseo/holidays-kr (관보 기준 대한민국 공휴일, 대체·임시공휴일 포함)
// 실행: npm run holidays:update   (npm run deploy 때 자동 실행)
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public';
const OUT = new URL('../src/lib/holidays-data.json', import.meta.url);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const now = new Date().getFullYear();
let data = {};
try { data = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* 처음 */ }

let fetched = 0;
for (let y = now - 1; y <= now + 3; y++) {
  try {
    const res = await fetch(`${BASE}/${y}.json`);
    if (res.status === 404) continue; // 아직 발표되지 않은 해
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const clean = {};
    for (const [d, names] of Object.entries(json)) {
      if (DATE.test(d) && d.startsWith(String(y)) && Array.isArray(names)) clean[d] = names.map(String).slice(0, 3);
    }
    if (!Object.keys(clean).length) throw new Error('빈 데이터');
    data[y] = clean;
    fetched++;
  } catch (e) {
    console.warn(`⚠ ${y}년 공휴일을 받지 못했습니다(기존 사본 유지): ${e.message}`);
  }
}
writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`);
console.log(`공휴일 사본 갱신: ${fetched}개 연도 → ${Object.keys(data).join(', ')}`);
