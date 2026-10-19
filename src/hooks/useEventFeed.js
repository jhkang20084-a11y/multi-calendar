import { useEffect, useRef, useState } from 'react';
import { listenEvents, getSecret } from '../services/events.js';
import { friendlyError } from '../services/errors.js';

/**
 * 여러 캘린더의 화면 범위 일정을 실시간으로 받는다.
 * - 필요한 (캘린더, 범위) 조합에 대해서만 리스너를 열고, 필요 없어진 리스너는 즉시 해제한다.
 * - 화면(컴포넌트)을 벗어나면 모든 리스너를 해제한다.
 */
export function useEventFeed(db, uid, calendarIds, range) {
  const [eventsByCal, setEventsByCal] = useState(() => new Map());
  const [statusByCal, setStatusByCal] = useState(() => new Map());
  const listeners = useRef(new Map()); // key → unsubscribe
  const rangeKey = `${range.startMs}-${range.endMs}`;
  const idsKey = [...calendarIds].sort().join(',');

  useEffect(() => {
    const wanted = new Map(calendarIds.map((id) => [`${id}|${rangeKey}`, id]));
    for (const [key, unsub] of listeners.current) {
      if (!wanted.has(key)) {
        unsub();
        listeners.current.delete(key);
      }
    }
    for (const [key, calId] of wanted) {
      if (listeners.current.has(key)) continue;
      setStatusByCal((m) => new Map(m).set(calId, { state: 'loading' }));
      const unsub = listenEvents(db, uid, calId, range, (events, meta) => {
        setEventsByCal((m) => new Map(m).set(calId, events));
        setStatusByCal((m) => new Map(m).set(calId, {
          state: 'ok', fromCache: meta.fromCache, pending: meta.hasPendingWrites,
        }));
      }, (err) => {
        listeners.current.delete(key);
        setEventsByCal((m) => { const n = new Map(m); n.delete(calId); return n; });
        setStatusByCal((m) => new Map(m).set(calId, { state: 'error', error: friendlyError(err), code: err.code }));
      });
      listeners.current.set(key, unsub);
    }
    // 더 이상 표시하지 않는 캘린더의 데이터는 정리
    const ids = new Set(calendarIds);
    setEventsByCal((m) => {
      if ([...m.keys()].every((k) => ids.has(k))) return m;
      return new Map([...m].filter(([k]) => ids.has(k)));
    });
    setStatusByCal((m) => {
      if ([...m.keys()].every((k) => ids.has(k))) return m;
      return new Map([...m].filter(([k]) => ids.has(k)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, uid, idsKey, rangeKey]);

  useEffect(() => () => {
    for (const unsub of listeners.current.values()) unsub();
    listeners.current.clear();
  }, []);

  return { eventsByCal, statusByCal };
}

/** 내가 만든 "시간만 공개" 일정의 실제 제목을 가져온다(작성자만 읽을 수 있는 secret 문서). */
export function useMySecrets(db, uid, eventsByCal) {
  const [secrets, setSecrets] = useState({});
  const fetched = useRef(new Map());
  useEffect(() => {
    for (const [calId, evs] of eventsByCal) {
      for (const ev of evs) {
        if (ev.visibility !== 'busy' || ev.createdBy !== uid) continue;
        const key = `${calId}/${ev.id}`;
        const version = ev.updatedAt?.toMillis?.() ?? 0;
        if (fetched.current.get(key) === version) continue;
        fetched.current.set(key, version);
        getSecret(db, calId, ev.id)
          .then((s) => setSecrets((cur) => ({ ...cur, [key]: s })))
          .catch(() => {});
      }
    }
  }, [db, uid, eventsByCal]);
  return secrets;
}
