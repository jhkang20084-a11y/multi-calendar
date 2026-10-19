import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useUi, Modal } from './ui.jsx';
import { db } from '../firebase.js';
import { groupByDate, whoLabel } from '../lib/feed.js';
import { formatTime } from '../lib/time.js';
import { holidayOf } from '../lib/holidays.js';
import { listenMemo, saveMemo } from '../services/memos.js';
import { canEdit } from '../services/calendars.js';
import { friendlyError } from '../services/errors.js';

/** 그날 일정 한 줄: 왼쪽 완료 체크(고칠 수 있는 일정만) + 누르면 일정 열기 */
function DayItem({ inst, tz, onOpen, canToggle, onToggle }) {
  return (
    <li className="day-item">
      {canToggle(inst) ? (
        <button type="button" className={`done-check ${inst.done ? 'on' : ''}`} role="checkbox" aria-checked={inst.done}
          aria-label={`${inst.title} 완료`} style={{ '--c': inst.color }}
          onClick={(e) => { e.stopPropagation(); onToggle(inst, !inst.done); }}>{inst.done ? '✓' : ''}</button>
      ) : <span className="done-check placeholder" aria-hidden />}
      <button type="button" className={`ruled-item ${inst.done ? 'chip-done' : ''}`} style={{ '--c': inst.color }} onClick={() => onOpen(inst)}>
        <span className="time">{inst.allDay ? '종일' : `${formatTime(inst.startMs, tz)}–${formatTime(inst.endMs, tz)}`}</span>
        <span className="main">
          <span className="title list-title">{inst.title}</span>
          <span className="sub">{whoLabel(inst)}{inst.location ? ` · ${inst.location}` : ''}</span>
        </span>
      </button>
    </li>
  );
}

export function useDayList(instances, date) {
  return useMemo(() => groupByDate(instances, date, date).get(date) || [], [instances, date]);
}

/** 그날 일정 목록 (달력 아래 Schedule 과 날짜를 눌렀을 때 뜨는 창에서 함께 씀) */
export function DayList({ date, instances, tz, onOpen, onCreate, canToggle, onToggle, minLines = 4 }) {
  const list = useDayList(instances, date);
  const blanks = Math.max(0, minLines - list.length - (list.length ? 1 : 2));
  return (
    <ul className="ruled">
      {list.map((inst) => <DayItem key={inst.key} inst={inst} tz={tz} onOpen={onOpen} canToggle={canToggle} onToggle={onToggle} />)}
      {list.length === 0 && <li><span className="ruled-empty">일정이 없어요 ♡</span></li>}
      <li>
        <button type="button" className="ruled-item ruled-add" onClick={() => onCreate(date)}>
          <span className="time">＋</span><span>일정 추가</span>
        </button>
      </li>
      {Array.from({ length: blanks }, (_, i) => <li key={`blank${i}`} aria-hidden />)}
    </ul>
  );
}

function dayTitle(date) {
  const dt = DateTime.fromISO(date).setLocale('ko');
  const hol = holidayOf(date);
  return <>{dt.toFormat('M월 d일 cccc')}{hol && <span style={{ color: 'var(--red)' }}> · {hol}</span>}</>;
}

/** 달력 아래: 선택한 날(처음엔 오늘)의 일정 */
export function DayNotes(props) {
  return (
    <section aria-label="선택한 날의 일정">
      <div className="note-head">
        <h2>Schedule</h2>
        <span className="note-date">{dayTitle(props.date)}</span>
      </div>
      <DayList {...props} />
    </section>
  );
}

/** 날짜를 누르면 뜨는 그날 일정 창. 바깥을 누르면 닫힌다. */
export function DayDialog({ onClose, ...props }) {
  return (
    <Modal title={dayTitle(props.date)} label={`${props.date} 일정`} onClose={onClose}>
      <DayList {...props} minLines={3} />
    </Modal>
  );
}

/** 캘린더별 이달의 메모 (멤버끼리 공유). 입력을 마치면(포커스가 빠지면) 저장한다. */
export function MonthMemo({ user, calendar, month }) {
  const { write } = useUi();
  const [text, setText] = useState('');
  const [server, setServer] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const editing = useRef(false);
  const dirty = text !== (server?.text ?? '');
  const editable = calendar && canEdit(calendar, user.uid);

  useEffect(() => {
    if (!calendar) return undefined;
    setServer(null); setText(''); setError(''); setStatus('');
    return listenMemo(db, calendar.id, month, (memo, meta) => {
      setServer(memo || { text: '' });
      if (!editing.current) setText(memo?.text ?? '');
      setStatus(meta.hasPendingWrites ? '동기화 중…' : '');
    }, (e) => setError(friendlyError(e)));
  }, [calendar?.id, month]);

  async function save() {
    editing.current = false;
    if (!dirty || !editable) return;
    setStatus('저장 중…');
    const r = await write(saveMemo(db, user, calendar.id, month, text), '메모를 저장했습니다.');
    setStatus(r === 'error' ? '저장하지 못했어요' : r === 'queued' ? '오프라인: 연결되면 저장' : '');
  }

  const who = server?.updatedBy && calendar?.memberInfo?.[server.updatedBy]?.name;
  return (
    <section aria-label="이달의 메모">
      <div className="note-head">
        <h2>Memo</h2>
        <span className="memo-status">
          {status || (dirty ? '저장 안 됨' : who ? `${who} 님이 마지막으로 씀` : calendar ? calendar.name : '')}
        </span>
      </div>
      {!calendar ? (
        <ul className="ruled">
          <li><span className="ruled-empty">캘린더를 하나 고르면</span></li>
          <li><span className="ruled-empty">그 캘린더의 이달 메모를 함께 쓸 수 있어요.</span></li>
          <li aria-hidden /><li aria-hidden />
        </ul>
      ) : error ? <p className="form-error">{error}</p> : (
        <textarea className="memo-area" value={text} readOnly={!editable} maxLength={5000}
          placeholder={editable ? '이달에 하고 싶은 것, 기억할 것…' : '아직 메모가 없어요.'}
          aria-label="이달의 메모"
          onFocus={() => { editing.current = true; }}
          onChange={(e) => setText(e.target.value)}
          onBlur={save} />
      )}
    </section>
  );
}
