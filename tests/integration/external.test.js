// 외부 캘린더(아이폰 iCloud 링크) 동기화 통합 테스트
// 실행: firebase emulators:exec --only auth,firestore,functions "vitest run tests/integration/external.test.js"
// 이 테스트 안에서 가짜 iCloud 서버(로컬 HTTP)를 띄워 ICS 를 제공한다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, memoryLocalCache, doc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { createExternalCalendar, requestExternalSync } from '../../src/services/calendars.js';
import { listenEvents } from '../../src/services/events.js';
import { viewRange } from '../../src/lib/time.js';

let ics = readFileSync('tests/fixtures/icloud-sample.ics', 'utf8');
let server; let port; let app; let db; let user;
const range = viewRange('month', '2026-10-01', 'Asia/Seoul', 0);

async function until(fn, label, ms = 30000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`시간 초과: ${label}`);
}
function liveDoc(path) {
  const box = { value: null };
  box.unsub = onSnapshot(doc(db, path), (s) => { box.value = s.data(); });
  return box;
}
function liveEvents(calId) {
  const box = { value: null, error: null };
  box.unsub = listenEvents(db, user.uid, calId, range, (evs) => { box.value = evs; }, (e) => { box.error = e; });
  return box;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/published/cal.ics') { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(ics); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-multi-calendar', appId: 'x' }, `ext-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  ({ user } = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `ext-${Date.now()}`, email: `ext-${Date.now()}@example.com`, email_verified: true }))));
}, 60000);

afterAll(async () => {
  server?.close();
  if (app) await deleteApp(app);
});

describe('외부 캘린더 동기화 (Cloud Functions)', () => {
  let calId;
  it('링크를 넣으면 서버가 바로 가져와 일정이 나타남', async () => {
    calId = await createExternalCalendar(db, user, { name: '아이폰', url: `https://127.0.0.1:${port}/published/cal.ics`, color: '#e6a157' });
    const cal = liveDoc(`calendars/${calId}`);
    const st = await until(() => (cal.value?.external?.status === 'ok' ? cal.value.external : null), '동기화 완료', 45000);
    expect(st.eventCount).toBe(8); // 저녁 약속, 제주 여행, 운동 5회, UTC 일정
    const evs = liveEvents(calId);
    const list = await until(() => (evs.value?.length === 8 ? evs.value : null), '일정 8개 수신');
    expect(list.map((e) => e.title)).toEqual(expect.arrayContaining(['저녁 약속', '제주 여행', '운동 (늦게)', 'UTC 일정']));
    expect(list.every((e) => e.createdBy === 'external')).toBe(true);
    cal.unsub(); evs.unsub();
  }, 60000);

  it('아이폰에서 지우고 바꾼 내용이 "지금 가져오기"로 반영됨', async () => {
    ics = ics.replace(/BEGIN:VEVENT\r?\nUID:utc@icloud[\s\S]*?END:VEVENT\r?\n/, '').replace('SUMMARY:저녁 약속', 'SUMMARY:저녁 약속 (장소 변경)');
    const evs = liveEvents(calId);
    await until(() => evs.value, '첫 목록');
    await requestExternalSync(db, user, calId);
    const list = await until(() => (evs.value?.some((e) => e.title === '저녁 약속 (장소 변경)') && evs.value.length === 7 ? evs.value : null), '변경 반영', 45000);
    expect(list.find((e) => e.title === 'UTC 일정')).toBeUndefined();
    evs.unsub();
  }, 60000);

  it('링크가 잘못되면 오류 상태로 표시', async () => {
    const bad = await createExternalCalendar(db, user, { name: '없는 링크', url: `https://127.0.0.1:${port}/nope.ics`, color: '#000' });
    const cal = liveDoc(`calendars/${bad}`);
    const st = await until(() => (cal.value?.external?.status === 'error' ? cal.value.external : null), '오류 표시', 45000);
    expect(st.error).toContain('찾을 수 없습니다');
    cal.unsub();
  }, 60000);

  it('캘린더를 지우면 서버가 남은 일정까지 정리', async () => {
    await deleteDoc(doc(db, 'calendars', calId));
    const url = `http://127.0.0.1:8080/v1/projects/demo-multi-calendar/databases/(default)/documents/calendars/${calId}/events`;
    await until(async () => {
      const r = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
      const j = await r.json();
      return !(j.documents?.length);
    }, '일정 정리', 45000);
  }, 60000);
});
