// 외부 캘린더(ICS) → 앱 일정 문서로 바꾸기. 네트워크나 Firestore 를 쓰지 않는 순수 함수라 단위 테스트한다.
import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';

export const DEFAULT_TZ = 'Asia/Seoul';
const DAY = 86400e3;

/** webcal:// 은 https:// 로 바꾼다(아이폰 공개 캘린더 링크는 webcal 로 시작). */
export function normalizeUrl(url) {
  return String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
}

/**
 * 서버가 내부망 주소를 대신 불러오지 않도록(SSRF) 공개 https 주소만 허용한다.
 * allowLocal: 에뮬레이터 테스트에서만 localhost 허용
 */
export function assertSafeUrl(url, allowLocal = false) {
  let u;
  try { u = new URL(url); } catch { throw new Error('링크 형식이 올바르지 않습니다.'); }
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')
    || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === '::1' || host.startsWith('[') || host === 'metadata.google.internal';
  if (allowLocal && local) return u;
  if (u.protocol !== 'https:') throw new Error('https 링크만 사용할 수 있습니다.');
  if (local) throw new Error('이 주소는 사용할 수 없습니다.');
  return u;
}

const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function dateString(t) {
  return `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/** ICAL.Time → UTC 밀리초. 시간대가 없는(floating) 시각은 기본 시간대로 본다. */
function toMs(t, defaultTz) {
  const tzid = t.zone?.tzid;
  if (tzid === 'UTC' || tzid === 'Z') return t.toUnixTime() * 1000;
  const zone = tzid && tzid !== 'floating' ? tzid : defaultTz;
  const dt = DateTime.fromObject({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second }, { zone });
  return dt.isValid ? dt.toMillis() : t.toUnixTime() * 1000; // 알 수 없는 시간대 이름이면 ical.js 계산 사용
}

const clip = (v, n) => String(v || '').replace(/\r/g, '').slice(0, n);

/**
 * ICS 본문 → [{ id, data }]
 * - 반복 일정은 화면에 쓰일 기간(과거 pastDays ~ 미래 futureDays) 안의 회차를 하나씩 펼쳐 저장한다.
 *   (아이폰의 복잡한 반복 규칙·개별 수정 회차도 그대로 반영되도록)
 * - 취소된 일정(STATUS:CANCELLED)은 뺀다.
 */
export function icsToEvents(text, { calendarId, now = Date.now(), pastDays = 180, futureDays = 400, max = 3000, perEvent = 600, defaultTz = DEFAULT_TZ } = {}) {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* 이미 등록됨 */ }
  }
  const windowStart = now - pastDays * DAY;
  const windowEnd = now + futureDays * DAY;

  const masters = new Map();
  const orphans = [];
  for (const ve of comp.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    if (!ev.uid) continue;
    if (ev.isRecurrenceException()) orphans.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of orphans) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex);
    else masters.set(`${ex.uid}#${ex.recurrenceId}`, ex);
  }

  const out = [];
  const push = (uid, item, start, end) => {
    if (out.length >= max) return;
    const status = String(item.component.getFirstPropertyValue('status') || '').toUpperCase();
    if (status === 'CANCELLED') return;
    const allDay = start.isDate;
    const data = {
      calendarId,
      title: clip(item.summary || '(제목 없음)', 200),
      description: clip(item.description, 5000),
      location: clip(item.location, 500),
      notes: '', color: '', category: '',
      allDay,
      startMs: null, endMs: null, startDate: null, endDate: null,
      timeZone: (!allDay && start.zone?.tzid && start.zone.tzid !== 'floating') ? start.zone.tzid : defaultTz,
      recurrence: null, exdates: [], recurringEventId: null, originalStart: null,
      visibility: 'members', kind: 'event', completed: false, reminders: [], showDday: false,
      createdBy: 'external', updatedBy: 'external',
    };
    let key;
    if (allDay) {
      data.startDate = dateString(start);
      // DTEND 는 다음 날(포함하지 않음)이므로 하루 빼서 마지막 날로
      const last = end ? addDays(dateString(end), -1) : data.startDate;
      data.endDate = last < data.startDate ? data.startDate : last;
      data.rangeStartMs = Date.parse(`${data.startDate}T00:00:00Z`) - 14 * 3600e3;
      data.rangeEndMs = Date.parse(`${addDays(data.endDate, 1)}T00:00:00Z`) + 14 * 3600e3;
      key = data.startDate;
    } else {
      data.startMs = toMs(start, defaultTz);
      data.endMs = Math.max(data.startMs, end ? toMs(end, defaultTz) : data.startMs + 3600e3);
      data.rangeStartMs = data.startMs;
      data.rangeEndMs = data.endMs;
      key = String(data.startMs);
    }
    if (data.rangeEndMs < windowStart || data.rangeStartMs > windowEnd) return;
    const fp = createHash('sha1').update(JSON.stringify(data)).digest('hex');
    out.push({ id: createHash('sha1').update(`${uid}|${key}`).digest('hex'), data: { ...data, fp } });
  };

  for (const [uid, ev] of masters) {
    if (out.length >= max) break;
    if (ev.isRecurring()) {
      const it = ev.iterator();
      let next;
      let n = 0;
      let kept = 0; // 한 반복 일정에서 저장한 회차 수 (매일 반복 등이 너무 많아지지 않게)
      while ((next = it.next()) && n++ < 20000) {
        const occStart = toMs(next, defaultTz);
        if (occStart > windowEnd) break;
        const d = ev.getOccurrenceDetails(next);
        if (toMs(d.endDate || d.startDate, defaultTz) + DAY < windowStart) continue;
        push(uid, d.item, d.startDate, d.endDate);
        if (++kept >= perEvent) break;
      }
    } else {
      push(uid, ev, ev.startDate, ev.endDate);
    }
  }
  return out;
}
