import { useState } from 'react';
import { DateTime } from 'luxon';
import { Modal, ColorPicker, useUi } from './ui.jsx';
import { PALETTE } from '../lib/colors.js';
import { TIMEZONES, msToLocalInput, localInputToMs, safeZone, addDays, daysBetween } from '../lib/time.js';
import { VISIBILITY_LABELS, createEvent, updateEvent, saveRecurringOccurrence } from '../services/events.js';
import { db } from '../firebase.js';

const WEEKDAY_OPTS = [[1, '월'], [2, '화'], [3, '수'], [4, '목'], [5, '금'], [6, '토'], [7, '일']];
const REMINDER_OPTS = [['', '없음'], ['0', '시작 시'], ['10', '10분 전'], ['30', '30분 전'], ['60', '1시간 전'], ['1440', '하루 전']];

/** 저장된 일정(또는 특정 회차) → 폼 상태 */
function toForm(base, defaults) {
  const tz = safeZone(base?.timeZone || defaults.timeZone);
  const r = base?.recurrence;
  const startDate = base?.startDate ?? defaults.startDate;
  // 종일 일정에는 시각이 없으므로, 시간 일정으로 바꿀 때를 대비해 그 날 오전 9시를 기본값으로 둔다.
  const fallbackStart = DateTime.fromISO(startDate, { zone: tz }).set({ hour: 9 }).toMillis();
  const startMs = base?.startMs ?? defaults.startMs ?? fallbackStart;
  const endMs = base?.endMs ?? defaults.endMs ?? startMs + 3600e3;
  return {
    calendarId: defaults.calendarId,
    title: base?.title ?? '',
    kind: base?.kind ?? 'event',
    allDay: base?.allDay ?? defaults.allDay,
    startLocal: msToLocalInput(startMs, tz),
    endLocal: msToLocalInput(endMs, tz),
    startDate,
    endDate: base?.endDate ?? startDate,
    timeZone: tz,
    repeat: r?.freq ?? 'NONE',
    interval: r?.interval ?? 1,
    byWeekday: r?.byWeekday ?? [],
    endType: r?.until ? 'until' : r?.count ? 'count' : 'never',
    until: r?.until ?? addDays(startDate, 30),
    count: r?.count ?? 10,
    location: base?.location ?? '',
    description: base?.description ?? '',
    notes: base?.notes ?? '',
    color: base?.color ?? '',
    category: base?.category ?? '',
    visibility: base?.visibility ?? 'members',
    reminder: base?.reminders?.length ? String(base.reminders[0]) : (defaults.reminder ?? ''),
    showDday: base?.showDday ?? false,
    completed: base?.completed ?? false,
  };
}

function toInput(f) {
  const recurrence = f.repeat === 'NONE' ? null : {
    freq: f.repeat,
    interval: Math.max(1, Number(f.interval) || 1),
    ...(f.repeat === 'WEEKLY' && f.byWeekday.length ? { byWeekday: [...f.byWeekday].sort() } : {}),
    ...(f.endType === 'until' ? { until: f.until } : {}),
    ...(f.endType === 'count' ? { count: Math.max(1, Number(f.count) || 1) } : {}),
  };
  return {
    title: f.title.trim(),
    kind: f.kind,
    allDay: f.kind === 'anniversary' ? true : f.allDay,
    startMs: localInputToMs(f.startLocal, f.timeZone),
    endMs: localInputToMs(f.endLocal, f.timeZone),
    startDate: f.startDate,
    endDate: f.kind === 'anniversary' ? f.startDate : f.endDate,
    timeZone: f.timeZone,
    recurrence,
    location: f.location,
    description: f.description,
    notes: f.notes,
    color: f.color,
    category: f.category,
    visibility: f.visibility,
    reminders: f.reminder === '' ? [] : [Number(f.reminder)],
    showDday: f.showDday,
    completed: f.completed,
  };
}

/**
 * props
 *  - mode: 'create' | 'edit'
 *  - editableCalendars: 일정을 만들 수 있는 캘린더 목록(소유자/편집자)
 *  - existing: 편집 시 { calendarId, eventId, ev(원본 문서), occKey, occ(회차 시작/끝), secret }
 *  - defaults: 생성 시 기본값
 */
export function EventEditor({ mode, user, editableCalendars, existing, defaults, onClose }) {
  const { write, confirm } = useUi();
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(() => {
    if (!isEdit) return toForm(null, defaults);
    const ev = { ...existing.ev, ...(existing.secret || {}), ...(existing.occ || {}) };
    return toForm(ev, { ...defaults, calendarId: existing.calendarId });
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const isRecurringOcc = isEdit && existing.ev.recurrence && existing.occKey;

  function validate(input) {
    if (!form.calendarId) return '캘린더를 선택하세요.';
    if (!input.title) return '제목을 입력하세요.';
    if (input.allDay) {
      if (!input.startDate) return '날짜를 입력하세요.';
      if (input.endDate < input.startDate) return '종료일이 시작일보다 빠릅니다.';
    } else {
      if (Number.isNaN(input.startMs) || Number.isNaN(input.endMs)) return '시간을 입력하세요.';
      if (input.endMs < input.startMs) return '종료 시간이 시작 시간보다 빠릅니다.';
    }
    if (input.recurrence?.until && input.recurrence.until < (input.allDay ? input.startDate : form.startLocal.slice(0, 10))) {
      return '반복 종료일이 시작일보다 빠릅니다.';
    }
    return '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    const input = toInput(form);
    const msg = validate(input);
    if (msg) { setError(msg); return; }
    setError('');
    let op;
    if (!isEdit) {
      op = createEvent(db, user, form.calendarId, input);
    } else if (isRecurringOcc) {
      const scope = await confirm({
        title: '반복 일정 수정',
        message: '어떤 일정을 수정할까요?',
        choices: [
          { value: 'this', label: '이 일정만' },
          { value: 'following', label: '이 일정 및 이후 일정' },
          { value: 'all', label: '모든 반복 일정' },
        ],
      });
      if (!scope) return;
      op = saveRecurringOccurrence(db, user, existing.calendarId, existing.eventId, existing.ev, existing.occKey, input, scope);
    } else {
      op = updateEvent(db, user, existing.calendarId, existing.eventId, existing.ev, input);
    }
    setSaving(true);
    const result = await write(op, isEdit ? '일정을 수정했습니다.' : '일정을 추가했습니다.');
    setSaving(false);
    if (result !== 'error') onClose();
  }

  const anniversary = form.kind === 'anniversary';
  const startDateForWeekday = form.allDay ? form.startDate : form.startLocal.slice(0, 10);

  return (
    <Modal title={isEdit ? '일정 수정' : '새 일정'} onClose={onClose} wide
      footer={(
        <>
          {error && <span className="form-error" role="alert">{error}</span>}
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="submit" form="event-form" className="btn btn-primary" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </>
      )}>
      <form id="event-form" className="form" onSubmit={onSubmit}>
        <div className="seg">
          <button type="button" className={!anniversary ? 'on' : ''} onClick={() => set('kind')('event')}>일정</button>
          <button type="button" className={anniversary ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, kind: 'anniversary', allDay: true, repeat: 'YEARLY' }))}>기념일</button>
        </div>
        <label className="field">
          <span>캘린더</span>
          <select value={form.calendarId} onChange={set('calendarId')} disabled={isEdit}>
            {editableCalendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {isEdit && <small>일정을 다른 캘린더로 옮기는 기능은 지원하지 않습니다.</small>}
        </label>
        <label className="field">
          <span>제목</span>
          <input className="title-input" value={form.title} onChange={set('title')} maxLength={200} placeholder={anniversary ? '예: 사귄 날, 엄마 생신' : '일정 제목'} autoFocus />
        </label>

        {!anniversary && (
          <label className="check"><input type="checkbox" checked={form.allDay} onChange={set('allDay')} /> 종일</label>
        )}
        {form.allDay || anniversary ? (
          <div className="row2">
            <label className="field"><span>{anniversary ? '기념일(시작일)' : '시작일'}</span>
              <input type="date" value={form.startDate} onChange={(e) => {
                const v = e.target.value;
                // 시작일을 옮기면 일정 길이(며칠짜리인지)를 유지하며 종료일도 함께 이동
                setForm((f) => ({ ...f, startDate: v, endDate: v && f.startDate && f.endDate >= f.startDate ? addDays(v, daysBetween(f.startDate, f.endDate)) : v }));
              }} /></label>
            {!anniversary && (
              <label className="field"><span>종료일</span>
                <input type="date" value={form.endDate} min={form.startDate} onChange={set('endDate')} /></label>
            )}
          </div>
        ) : (
          <div className="row2 row-dt">
            <label className="field"><span>시작</span>
              <input type="datetime-local" value={form.startLocal} onChange={(e) => {
                const v = e.target.value;
                setForm((f) => {
                  // 시작을 옮기면 기존 길이를 유지하며 종료도 함께 이동
                  const dur = localInputToMs(f.endLocal, f.timeZone) - localInputToMs(f.startLocal, f.timeZone);
                  const ns = localInputToMs(v, f.timeZone);
                  return { ...f, startLocal: v, endLocal: Number.isNaN(ns) ? f.endLocal : msToLocalInput(ns + Math.max(0, dur), f.timeZone) };
                });
              }} /></label>
            <label className="field"><span>종료</span>
              <input type="datetime-local" value={form.endLocal} onChange={set('endLocal')} /></label>
          </div>
        )}
        {!form.allDay && !anniversary && (
          <label className="field"><span>시간대</span>
            <select value={form.timeZone} onChange={(e) => {
              const tz = e.target.value;
              setForm((f) => ({ ...f, timeZone: tz })); // 입력한 현지 시각은 그대로, 시간대만 변경
            }}>
              {[...new Set([form.timeZone, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
        )}

        {!anniversary && (
          <fieldset className="fieldset">
            <legend>반복</legend>
            <div className="row2">
              <select value={form.repeat} onChange={set('repeat')} aria-label="반복 주기">
                <option value="NONE">반복 안 함</option>
                <option value="DAILY">매일</option>
                <option value="WEEKLY">매주</option>
                <option value="MONTHLY">매월</option>
                <option value="YEARLY">매년</option>
              </select>
              {form.repeat !== 'NONE' && (
                <label className="inline">간격 <input type="number" min="1" max="99" value={form.interval} onChange={set('interval')} style={{ width: 64 }} /></label>
              )}
            </div>
            {form.repeat === 'WEEKLY' && (
              <div className="weekday-pick">
                {WEEKDAY_OPTS.map(([n, l]) => (
                  <button type="button" key={n}
                    className={(form.byWeekday.length ? form.byWeekday.includes(n) : DateTime.fromISO(startDateForWeekday).weekday === n) ? 'on' : ''}
                    onClick={() => setForm((f) => {
                      const cur = f.byWeekday.length ? f.byWeekday : [DateTime.fromISO(startDateForWeekday).weekday];
                      const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
                      return { ...f, byWeekday: next.length ? next : cur };
                    })}>{l}</button>
                ))}
              </div>
            )}
            {form.repeat !== 'NONE' && (
              <div className="row2">
                <select value={form.endType} onChange={set('endType')} aria-label="반복 종료">
                  <option value="never">계속 반복</option>
                  <option value="until">날짜까지</option>
                  <option value="count">횟수</option>
                </select>
                {form.endType === 'until' && <input type="date" value={form.until} onChange={set('until')} aria-label="반복 종료일" />}
                {form.endType === 'count' && <label className="inline"><input type="number" min="1" max="999" value={form.count} onChange={set('count')} style={{ width: 72 }} />회</label>}
              </div>
            )}
            {isRecurringOcc && <small>저장할 때 이 일정만 / 이후 일정 / 전체 중에서 선택합니다. "이 일정만"을 고르면 반복 설정 변경은 무시됩니다.</small>}
          </fieldset>
        )}
        {anniversary && <p className="hint">기념일은 매년 반복되며 D-day 와 며칠째인지가 표시됩니다.</p>}

        <label className="field"><span>장소</span><input value={form.location} onChange={set('location')} maxLength={500} /></label>
        <label className="field"><span>설명</span><textarea rows={3} value={form.description} onChange={set('description')} maxLength={5000} /></label>
        <label className="field"><span>메모</span><textarea rows={3} value={form.notes} onChange={set('notes')} maxLength={10000} placeholder="함께 볼 메모 (체크리스트는 저장 후 일정 상세에서 추가)" /></label>

        <div className="field"><span>색상</span><ColorPicker value={form.color} onChange={set('color')} palette={PALETTE} allowNone /></div>
        <label className="field"><span>분류</span><input value={form.category} onChange={set('category')} maxLength={40} placeholder="예: 데이트, 업무, 병원" /></label>

        <label className="field"><span>공개 범위</span>
          <select value={form.visibility} onChange={set('visibility')}
            disabled={isEdit && existing.ev.createdBy !== user.uid}>
            {Object.entries(VISIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <small>
            {form.visibility === 'busy' && '다른 멤버에게는 "바쁨"과 시간만 보이고 제목·장소·설명·메모·체크리스트는 숨겨집니다.'}
            {form.visibility === 'private' && '다른 멤버에게 이 일정이 전혀 보이지 않습니다.'}
            {form.visibility === 'members' && '이 캘린더의 모든 멤버(및 이 캘린더를 구독한 멤버)가 볼 수 있습니다.'}
            {isEdit && existing.ev.createdBy !== user.uid && ' (공개 범위는 작성자만 바꿀 수 있습니다)'}
          </small>
        </label>
        <div className="row2">
          <label className="field"><span>알림</span>
            <select value={form.reminder} onChange={set('reminder')}>
              {REMINDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {!anniversary && <label className="check"><input type="checkbox" checked={form.showDday} onChange={set('showDday')} /> D-day 표시</label>}
        </div>
      </form>
    </Modal>
  );
}
