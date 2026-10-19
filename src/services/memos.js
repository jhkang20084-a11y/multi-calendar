import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

/** 캘린더별 "이달의 메모" (문서 ID = 'YYYY-MM'). 멤버는 읽고, 소유자·편집자는 쓴다. */
const memoRef = (db, calId, month) => doc(db, 'calendars', calId, 'memos', month);

export function listenMemo(db, calId, month, cb, onError) {
  return onSnapshot(memoRef(db, calId, month), { includeMetadataChanges: true },
    (s) => cb(s.exists() ? s.data() : null, s.metadata), onError);
}

export function saveMemo(db, user, calId, month, text) {
  return setDoc(memoRef(db, calId, month), {
    text: text.slice(0, 5000),
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
}
