import {
  collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';

const todoCol = (db, calId, eventId) => collection(db, 'calendars', calId, 'events', eventId, 'todos');

export function listenTodos(db, calId, eventId, cb, onError) {
  return onSnapshot(query(todoCol(db, calId, eventId), orderBy('order')), { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites }))),
    onError);
}

export async function addTodo(db, user, calId, eventId, text, assigneeUid = null) {
  const ref = doc(todoCol(db, calId, eventId));
  await setDoc(ref, {
    text: text.trim().slice(0, 500),
    done: false,
    assigneeUid,
    order: Date.now(),
    doneBy: null,
    doneAt: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function toggleTodo(db, user, calId, eventId, todoId, done) {
  return updateDoc(doc(todoCol(db, calId, eventId), todoId), {
    done,
    doneBy: done ? user.uid : null,
    doneAt: done ? serverTimestamp() : null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
}

export function updateTodo(db, user, calId, eventId, todoId, patch) {
  const p = {};
  if ('text' in patch) p.text = patch.text.trim().slice(0, 500);
  if ('assigneeUid' in patch) p.assigneeUid = patch.assigneeUid || null;
  return updateDoc(doc(todoCol(db, calId, eventId), todoId), { ...p, updatedBy: user.uid, updatedAt: serverTimestamp() });
}

export function deleteTodo(db, calId, eventId, todoId) {
  return deleteDoc(doc(todoCol(db, calId, eventId), todoId));
}
