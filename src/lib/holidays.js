import SNAPSHOT from './holidays-data.json';

/**
 * 대한민국 공휴일을 자동으로 가져온다.
 * - 출처: https://github.com/hyunbinseo/holidays-kr (관보 기준, 대체·임시공휴일·선거일 포함, 정부 발표 시 갱신)
 * - 화면에 필요한 연도를 앱이 직접 내려받고(하루 동안 기기에 저장), 실패하면 앱에 들어 있는 사본을 쓴다.
 * - 사본은 `npm run holidays:update` (배포할 때 자동 실행)로 최신화한다.
 */
const SOURCE = 'https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public';
const CACHE_KEY = 'holidays-kr:v1:';
const TTL_MS = 24 * 3600e3;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const byYear = new Map(Object.entries(SNAPSHOT).map(([y, days]) => [Number(y), days]));
const requested = new Set();
const listeners = new Set();
let version = 0;

/** 외부 데이터는 형식을 검사한 뒤에만 쓴다. */
function sanitize(year, json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const out = {};
  for (const [d, names] of Object.entries(json)) {
    if (DATE.test(d) && d.startsWith(String(year)) && Array.isArray(names)) {
      out[d] = names.filter((n) => typeof n === 'string').map((n) => n.slice(0, 40)).slice(0, 3);
    }
  }
  return Object.keys(out).length ? out : null;
}

function readCache(year) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY + year));
    return raw && Date.now() - raw.at < TTL_MS ? sanitize(year, raw.days) : null;
  } catch { return null; }
}

function store(year, days) {
  byYear.set(year, days);
  version++;
  listeners.forEach((l) => l());
}

/** 연도별 공휴일을 (아직 안 받았다면) 내려받는다. 실패해도 앱 사본으로 계속 동작한다. */
export function loadHolidayYears(years) {
  for (const year of years) {
    if (requested.has(year)) continue;
    requested.add(year);
    const cached = typeof localStorage !== 'undefined' ? readCache(year) : null;
    if (cached) { store(year, cached); continue; }
    if (typeof fetch === 'undefined') continue;
    fetch(`${SOURCE}/${year}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const days = sanitize(year, json);
        if (!days) return;
        try { localStorage.setItem(CACHE_KEY + year, JSON.stringify({ at: Date.now(), days })); } catch { /* 저장소 사용 불가 */ }
        store(year, days);
      })
      .catch(() => { requested.delete(year); }); // 오프라인이면 다음에 다시 시도
  }
}

export function subscribeHolidays(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const holidaysVersion = () => version;

/** 달력 칸에 들어갈 짧은 이름 */
export function shortHolidayName(name) {
  if (name.startsWith('대체공휴일')) return '대체휴일';
  return ({
    '1월 1일': '신정', '기독탄신일': '성탄절', '부처님 오신 날': '부처님오신날',
    '전국동시지방선거': '지방선거', '설날 전날': '설날 연휴', '설날 다음 날': '설날 연휴',
    '추석 전날': '추석 연휴', '추석 다음 날': '추석 연휴',
  })[name] || name;
}

/** 'YYYY-MM-DD' → 공휴일 이름(짧게) 또는 null */
export function holidayOf(date) {
  const names = byYear.get(Number(date.slice(0, 4)))?.[date];
  return names?.length ? names.map(shortHolidayName).join('·') : null;
}

/** 'YYYY-MM-DD' → 공휴일 정식 이름 또는 null */
export function holidayFullName(date) {
  return byYear.get(Number(date.slice(0, 4)))?.[date]?.join(', ') || null;
}

// 공휴일은 아니지만 달력에 적어 두면 좋은 날 (검정 글씨)
const SPECIAL = { '10-31': '할로윈', '12-24': '크리스마스 이브', '02-14': '밸런타인데이', '03-14': '화이트데이' };

export function specialDayOf(date) {
  return SPECIAL[date.slice(5)] || null;
}
