/**
 * 일정 분류(카테고리) — 캘린더마다 캘린더 설정에서 이름과 색을 정한다.
 * 일정에는 분류 id 만 저장하므로, 분류 색을 바꾸면 그 분류의 모든 일정 색이 함께 바뀐다.
 */
export const DEFAULT_CATEGORIES = [
  { id: 'plan', name: '일정', color: '#6f95c4' },
  { id: 'date', name: '약속', color: '#e8a3a0' },
  { id: 'work', name: '업무', color: '#7d8a96' },
  { id: 'study', name: '공부', color: '#9b87c4' },
  { id: 'health', name: '운동', color: '#8fa876' },
  { id: 'hospital', name: '병원', color: '#e4513a' },
  { id: 'trip', name: '여행', color: '#e6a157' },
  { id: 'anniv', name: '기념일', color: '#d9b44a' },
];

export const MAX_CATEGORIES = 20;

export function categoriesOf(cal) {
  return Array.isArray(cal?.categories) && cal.categories.length ? cal.categories : DEFAULT_CATEGORIES;
}

export function categoryOf(cal, id) {
  return id ? categoriesOf(cal).find((c) => c.id === id) || null : null;
}

/**
 * 일정이 화면에 표시될 색
 * - 다른 캘린더를 구독해서 보이는 일정: 분류와 상관없이 원본 캘린더의 대표 색으로 고정
 * - 그 외: 분류 색 → (예전 일정의) 직접 고른 색 → 캘린더 대표 색
 */
export function eventColor(ev, cal, subscribed = false) {
  if (subscribed) return cal?.color;
  return categoryOf(cal, ev.category)?.color || ev.color || cal?.color;
}

/** 캘린더 설정에서 저장하기 전에 분류 목록을 정리한다. */
export function cleanCategories(list) {
  const seen = new Set();
  return list
    .map((c) => ({ id: String(c.id || '').slice(0, 40), name: String(c.name || '').trim().slice(0, 20), color: String(c.color || '').slice(0, 20) }))
    .filter((c) => c.id && c.name && !seen.has(c.id) && seen.add(c.id))
    .slice(0, MAX_CATEGORIES);
}
