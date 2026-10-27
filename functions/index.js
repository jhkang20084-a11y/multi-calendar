// Firebase Cloud Functions: 외부 캘린더(아이폰 iCloud 공개 링크 등) 동기화 + 캘린더 삭제 정리
// 배포에는 Blaze(사용량 기반) 요금제가 필요하다.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { icsToEvents, normalizeUrl, assertSafeUrl } from './ics.js';
import { buildWidgetFeed, TOKEN_RE } from './widget.js';

initializeApp();
const db = getFirestore();
// Firestore 데이터베이스와 같은 지역(서울)
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 5, memory: '256MiB', timeoutSeconds: 120 });

const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_INTERVAL_MS = isEmulator ? 0 : 60 * 1000; // 같은 캘린더를 1분 안에 다시 가져오지 않음

async function fetchIcs(url) {
  const u = assertSafeUrl(normalizeUrl(url), isEmulator);
  if (isEmulator && u.hostname === '127.0.0.1') u.protocol = 'http:'; // 에뮬레이터 테스트용 로컬 가짜 서버
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(u, { signal: ctrl.signal, redirect: 'follow', headers: { accept: 'text/calendar, */*' } });
    if (!res.ok) throw new Error(res.status === 404 ? '링크를 찾을 수 없습니다(공개 캘린더가 꺼졌을 수 있어요).' : `캘린더를 가져오지 못했습니다 (HTTP ${res.status}).`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('캘린더가 너무 큽니다.');
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('캘린더(ICS) 링크가 아닙니다.');
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('캘린더 서버가 응답하지 않습니다.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 외부 캘린더 하나를 가져와 일정 문서를 맞춘다(새 것 추가, 바뀐 것 수정, 없어진 것 삭제). */
export async function syncCalendar(calId) {
  const calRef = db.doc(`calendars/${calId}`);
  const snap = await calRef.get();
  const cal = snap.data();
  if (!snap.exists || !cal?.external?.url) return;
  const last = cal.external.lastSyncAt?.toMillis?.() || 0;
  if (Date.now() - last < MIN_INTERVAL_MS && cal.external.status === 'ok') return;

  await calRef.update({ 'external.status': 'syncing' });
  try {
    const text = await fetchIcs(cal.external.url);
    const events = icsToEvents(text, { calendarId: calId });
    const col = calRef.collection('events');
    const existing = await col.select('fp').get();
    const oldFp = new Map(existing.docs.map((d) => [d.id, d.get('fp')]));
    const writer = db.bulkWriter();
    let changed = 0;
    for (const { id, data } of events) {
      if (oldFp.get(id) === data.fp) { oldFp.delete(id); continue; }
      const now = FieldValue.serverTimestamp();
      if (oldFp.has(id)) writer.set(col.doc(id), { ...data, updatedAt: now }, { merge: true }); // 바뀐 일정
      else writer.set(col.doc(id), { ...data, createdAt: now, updatedAt: now }); // 새 일정
      oldFp.delete(id);
      changed++;
    }
    for (const id of oldFp.keys()) writer.delete(col.doc(id)); // 원본에서 지워진 일정
    await writer.close();
    await calRef.update({
      'external.status': 'ok',
      'external.error': FieldValue.delete(),
      'external.lastSyncAt': FieldValue.serverTimestamp(),
      'external.eventCount': events.length,
    });
    logger.info('external sync', { calId, events: events.length, changed, removed: oldFp.size });
  } catch (e) {
    logger.warn('external sync failed', { calId, error: e.message });
    await calRef.update({
      'external.status': 'error',
      'external.error': String(e.message || e).slice(0, 300),
      'external.lastSyncAt': FieldValue.serverTimestamp(),
    });
  }
}

// 외부 캘린더를 추가하면 바로 한 번 가져온다.
export const externalCalendarCreated = onDocumentCreated('calendars/{calId}', async (event) => {
  if (event.data?.data()?.external?.url) await syncCalendar(event.params.calId);
});

// 앱에서 "지금 새로 가져오기"를 누르면(syncRequestedAt 변경) 다시 가져온다.
export const externalCalendarSyncRequested = onDocumentUpdated('calendars/{calId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after?.external?.url) return;
  const b = before?.syncRequestedAt?.toMillis?.() || 0;
  const a = after?.syncRequestedAt?.toMillis?.() || 0;
  if (a > b) await syncCalendar(event.params.calId);
});

// 30분마다 모든 외부 캘린더를 새로 가져온다.
export const externalCalendarsScheduled = onSchedule({ schedule: 'every 30 minutes', timeZone: 'Asia/Seoul' }, async () => {
  const snap = await db.collection('calendars').where('external.url', '>', '').get();
  for (const d of snap.docs) {
    await syncCalendar(d.id).catch((e) => logger.error('scheduled sync', { calId: d.id, error: e.message }));
  }
});

// 캘린더를 지우면 남은 하위 데이터(다른 멤버의 비공개 일정 등 앱에서 못 지운 것)까지 정리한다.
export const calendarDeleted = onDocumentDeleted('calendars/{calId}', async (event) => {
  await db.recursiveDelete(db.doc(`calendars/${event.params.calId}`));
});

// 아이폰 홈 화면 위젯이 30분마다 불러가는 일정 피드. ?t=<앱이 만든 비밀 토큰>
export const widgetFeed = onRequest({ invoker: 'public', memory: '256MiB', timeoutSeconds: 30 }, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }
  const token = String(req.query.t || '');
  if (!TOKEN_RE.test(token)) { res.status(400).json({ error: 'token' }); return; }
  const snap = await db.doc(`widgetTokens/${token}`).get();
  const uid = snap.get('uid');
  if (!snap.exists || !uid) { res.status(401).json({ error: 'revoked' }); return; }
  try {
    res.json(await buildWidgetFeed(db, uid, snap.get('calendarId')));
  } catch (e) {
    logger.error('widget feed', { uid, error: e.message });
    res.status(500).json({ error: 'server' });
  }
});
