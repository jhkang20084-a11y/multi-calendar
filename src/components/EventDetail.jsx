import { useEffect, useState } from 'react';
import { Modal, Avatar, useUi } from './ui.jsx';
import { db } from '../firebase.js';
import { listenEvent, getSecret, deleteEvent, deleteRecurringOccurrence, setOccurrenceCompleted, VISIBILITY_LABELS } from '../services/events.js';
import { listenTodos, addTodo, toggleTodo, updateTodo, deleteTodo } from '../services/todos.js';
import { canEdit, ROLE_LABELS, roleOf } from '../services/calendars.js';
import { describeRecurrence } from '../lib/recurrence.js';
import { naverMapUrl } from '../lib/maps.js';
import { formatTime, formatDateLabel, safeZone, msToDate, todayISO } from '../lib/time.js';
import { ddayLabel, anniversarySummary } from '../lib/dday.js';
import { friendlyError } from '../services/errors.js';

function whenText(inst, tz) {
  if (inst.allDay) {
    return inst.startDate === inst.endDate
      ? `${formatDateLabel(inst.startDate, tz)} · 종일`
      : `${formatDateLabel(inst.startDate, tz)} ~ ${formatDateLabel(inst.endDate, tz)} · 종일`;
  }
  const s = `${formatDateLabel(inst.startDate, tz)} ${formatTime(inst.startMs, tz)}`;
  const e = inst.startDate === inst.endDate ? formatTime(inst.endMs, tz) : `${formatDateLabel(inst.endDate, tz)} ${formatTime(inst.endMs, tz)}`;
  return `${s} ~ ${e}`;
}

export function TodoList({ user, calId, eventId, members, editable }) {
  const { write, toast } = useUi();
  const [todos, setTodos] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [assignee, setAssignee] = useState('');
  const [editing, setEditing] = useState(null);

  useEffect(() => listenTodos(db, calId, eventId, setTodos, (e) => setError(friendlyError(e))), [calId, eventId]);

  if (error) return <p className="form-error">{error}</p>;
  if (!todos) return <p className="muted">체크리스트 불러오는 중…</p>;
  const done = todos.filter((t) => t.done).length;
  const nameOf = (uid) => members[uid]?.name || '알 수 없음';

  return (
    <div className="todos">
      <div className="todos-head">
        <strong>체크리스트</strong>
        {todos.length > 0 && <span className="muted">{done}/{todos.length} 완료</span>}
      </div>
      {todos.length === 0 && <p className="muted">할 일이 없습니다.</p>}
      <ul>
        {todos.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <label className="todo-check">
              <input type="checkbox" checked={t.done} disabled={!editable}
                onChange={(e) => write(toggleTodo(db, user, calId, eventId, t.id, e.target.checked), e.target.checked ? '완료 처리했습니다.' : '완료를 취소했습니다.')} />
            </label>
            {editing?.id === t.id ? (
              <form className="todo-edit" onSubmit={(e) => {
                e.preventDefault();
                if (!editing.text.trim()) return;
                write(updateTodo(db, user, calId, eventId, t.id, { text: editing.text, assigneeUid: editing.assignee || null }), '할 일을 수정했습니다.');
                setEditing(null);
              }}>
                <input value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} autoFocus maxLength={500} />
                <select value={editing.assignee} onChange={(e) => setEditing({ ...editing, assignee: e.target.value })} aria-label="담당자">
                  <option value="">담당자 없음</option>
                  {Object.entries(members).map(([uid, m]) => <option key={uid} value={uid}>{m.name}</option>)}
                </select>
                <button className="btn btn-small btn-primary">저장</button>
                <button type="button" className="btn btn-small" onClick={() => setEditing(null)}>취소</button>
              </form>
            ) : (
              <span className="todo-text">
                {t.text}
                {t.assigneeUid && <span className="tag">👤 {nameOf(t.assigneeUid)}</span>}
                {t.done && t.doneBy && <span className="muted small"> · {nameOf(t.doneBy)} 완료</span>}
                {t.pending && <span className="muted small"> · 동기화 중</span>}
              </span>
            )}
            {editable && editing?.id !== t.id && (
              <span className="todo-actions">
                <button className="icon-btn" onClick={() => setEditing({ id: t.id, text: t.text, assignee: t.assigneeUid || '' })} aria-label="할 일 수정">✎</button>
                <button className="icon-btn" onClick={() => write(deleteTodo(db, calId, eventId, t.id), '할 일을 삭제했습니다.')} aria-label="할 일 삭제">🗑</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form className="todo-add" onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) { toast('error', '할 일 내용을 입력하세요.'); return; }
          write(addTodo(db, user, calId, eventId, text, assignee || null), '할 일을 추가했습니다.');
          setText('');
        }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="할 일 추가" maxLength={500} />
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="담당자">
            <option value="">담당자</option>
            {Object.entries(members).map(([uid, m]) => <option key={uid} value={uid}>{m.name}</option>)}
          </select>
          <button className="btn btn-primary btn-small">추가</button>
        </form>
      )}
    </div>
  );
}

/**
 * 일정 상세. 원본 문서를 실시간으로 다시 구독하므로, 열어 둔 동안 다른 멤버가 수정/삭제해도 바로 반영된다.
 */
/**
 * 일정 삭제(반복 일정이면 범위 선택). 삭제를 진행했으면 true.
 */
export async function deleteWithConfirm({ confirm, write, user, inst, ev, title }) {
  let op;
  if (ev.recurrence && inst.occKey) {
    const scope = await confirm({
      title: '반복 일정 삭제',
      message: '어떤 일정을 삭제할까요? 모든 멤버의 화면에서 함께 사라집니다.',
      choices: [
        { value: 'this', label: '이 일정만', danger: true },
        { value: 'following', label: '이 일정 및 이후 일정', danger: true },
        { value: 'all', label: '모든 반복 일정', danger: true },
      ],
    });
    if (!scope) return false;
    op = deleteRecurringOccurrence(db, user, inst.calendarId, inst.eventId, ev, inst.occKey, scope);
  } else {
    const ok = await confirm({ title: '일정 삭제', message: `"${title}" 일정을 삭제할까요? 모든 멤버와 구독 화면에서 사라집니다.`, okLabel: '삭제', danger: true });
    if (!ok) return false;
    op = deleteEvent(db, user, inst.calendarId, inst.eventId, ev);
  }
  return (await write(op, '일정을 삭제했습니다.')) !== 'error';
}

export function EventDetail({ inst, calendar, viaCalendar, user, tz, onEdit, onClose }) {
  const { write, confirm } = useUi();
  const [ev, setEv] = useState(inst.ev);
  const [deleted, setDeleted] = useState(false);
  const [secret, setSecret] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => listenEvent(db, inst.calendarId, inst.eventId, (d) => {
    if (!d) setDeleted(true); else setEv(d);
  }, (e) => setError(friendlyError(e))), [inst.calendarId, inst.eventId]);

  const mine = ev.createdBy === user.uid;
  useEffect(() => {
    if (ev.visibility === 'busy' && mine) getSecret(db, inst.calendarId, inst.eventId).then(setSecret).catch(() => {});
  }, [ev.visibility, ev.updatedAt, mine, inst.calendarId, inst.eventId]);

  const members = calendar?.memberInfo || {};
  const role = roleOf(calendar, user.uid);
  const canSeeDetails = ev.visibility === 'members' || mine;
  const editable = canEdit(calendar, user.uid) && canSeeDetails;
  const shown = ev.visibility === 'busy' ? (secret || {}) : ev;
  const title = ev.visibility === 'busy' && !mine ? '바쁨' : (shown.title || '(제목 없음)');
  const zone = safeZone(tz);

  async function onDelete() {
    if (await deleteWithConfirm({ confirm, write, user, inst, ev, title })) onClose();
  }

  if (deleted) {
    return (
      <Modal title="일정" onClose={onClose} small>
        <p>이 일정은 삭제되었습니다.</p>
      </Modal>
    );
  }

  const anniv = ev.kind === 'anniversary' ? anniversarySummary(ev, zone) : null;
  const today = todayISO(zone);
  // 반복이 아닌 일정은 실시간으로 받은 최신 시간으로 표시
  const when = ev.recurrence ? inst : ev.allDay
    ? { allDay: true, startDate: ev.startDate, endDate: ev.endDate }
    : { allDay: false, startMs: ev.startMs, endMs: ev.endMs, startDate: msToDate(ev.startMs, zone), endDate: msToDate(Math.max(ev.startMs, ev.endMs - 1), zone) };

  return (
    <Modal title="일정 상세" onClose={onClose}
      footer={editable ? (
        <>
          <button className="btn btn-danger" onClick={onDelete}>삭제</button>
          <button className="btn btn-primary" onClick={() => onEdit({ ...inst, ev }, secret)}>수정</button>
        </>
      ) : null}>
      {error && <p className="form-error">{error}</p>}
      <div className="detail">
        <div className="detail-title">
          <span className="dot" style={{ background: inst.color || calendar?.color }} />
          <h3 className={inst.done ? 'strike' : ''}>{inst.virtual ? inst.title : title}</h3>
        </div>
        <p className="detail-when">{whenText(when, zone)}{!when.allDay && ev.timeZone !== zone && <span className="muted"> (일정 시간대: {ev.timeZone})</span>}</p>
        {ev.recurrence && <p className="muted">🔁 {describeRecurrence(ev.recurrence)}</p>}
        {ev.recurringEventId && <p className="muted">🔁 반복 일정에서 개별 수정된 회차</p>}
        {inst.virtual && <p className="muted">"{title}"부터 {inst.milestoneDays.toLocaleString('ko-KR')}일째 되는 날 (자동 계산)</p>}
        {anniv && <p className="dday-line">{anniv.countLabel} · 다음 {anniv.nextYearly.years}주년 {anniv.nextYearlyLabel}{anniv.milestone && ` · ${anniv.milestone.days}일 ${ddayLabel(anniv.milestone.date, today)}`}</p>}
        {!anniv && ev.showDday && <p className="dday-line">{ddayLabel(when.startDate, today)}</p>}

        <div className="source-box">
          <span className="dot" style={{ background: calendar?.color }} />
          <span>
            <b>{calendar?.name}</b>
            {members[ev.createdBy]?.name && <span> · {members[ev.createdBy].name}님 일정</span>}
            {inst.subscribed && viaCalendar && <span className="muted"> · {viaCalendar.name}에서 함께 보는 중</span>}
          </span>
        </div>
        {calendar?.external
          ? <p className="hint">외부 캘린더(아이폰 등)에서 가져온 일정이에요. 수정은 원래 캘린더에서 해 주세요. 30분마다 새로 가져와요.</p>
          : !editable && <p className="muted small">내 역할: {ROLE_LABELS[role] || '없음'} — 이 일정은 볼 수만 있어요.</p>}

        {canSeeDetails ? (
          <>
            {shown.location && (
              <p>📍 <a className="map-link" href={naverMapUrl(shown.location)} target="_blank" rel="noopener noreferrer">{shown.location} <span className="small">(네이버 지도)</span></a></p>
            )}
            {shown.description && <p className="pre">{shown.description}</p>}
            {inst.categoryName && <p><span className="tag" style={{ borderColor: inst.color }}>{inst.categoryName}</span></p>}
            {shown.notes && (<div className="notes"><strong>메모</strong><p className="pre">{shown.notes}</p></div>)}
          </>
        ) : (
          <p className="hint">작성자가 "시간만 공개"로 설정한 일정이라 세부 내용을 볼 수 없습니다.</p>
        )}

        {!calendar?.external && <p className="muted small">공개 범위: {VISIBILITY_LABELS[ev.visibility]}{ev.reminders?.length ? ` · 알림 ${ev.reminders[0] === 0 ? '시작 시' : `${ev.reminders[0]}분 전`}` : ''}</p>}

        {editable && (
          <label className="check">
            <input type="checkbox" checked={Boolean(inst.done)} onChange={(e) => write(setOccurrenceCompleted(db, user, inst.calendarId, inst.eventId, inst.occKey, e.target.checked), e.target.checked ? '완료로 표시했습니다.' : '완료 표시를 해제했습니다.')} />
            완료
          </label>
        )}
        {!editable && inst.done && <p>✅ 완료됨</p>}

        {canSeeDetails && !calendar?.external && (
          <TodoList user={user} calId={inst.calendarId} eventId={inst.eventId} members={members} editable={editable} />
        )}
        {ev.recurrence && canSeeDetails && <p className="muted small">체크리스트와 메모는 반복 일정 전체에 공통으로 연결됩니다.</p>}

        {!calendar?.external && <div className="meta">
          <span><Avatar name={members[ev.createdBy]?.name} photoURL={members[ev.createdBy]?.photoURL} size={20} /> 작성: {members[ev.createdBy]?.name || '이전 멤버'}</span>
          {ev.updatedBy && <span>수정: {members[ev.updatedBy]?.name || '이전 멤버'}{ev.updatedAt?.toDate ? ` · ${ev.updatedAt.toDate().toLocaleString('ko-KR')}` : ''}</span>}
        </div>}
      </div>
    </Modal>
  );
}
