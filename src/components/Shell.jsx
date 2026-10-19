import { useMemo, useState } from 'react';
import { Avatar, Modal, useUi, Torn } from './ui.jsx';
import { db, logout } from '../firebase.js';
import { updateSettings } from '../services/users.js';
import { roleOf, ROLE_LABELS } from '../services/calendars.js';
import { coverStyle } from '../lib/colors.js';
import { anniversarySummary, ddayLabel } from '../lib/dday.js';
import { expandEvent } from '../lib/recurrence.js';
import { TIMEZONES, todayISO, addDays, msToDate } from '../lib/time.js';

export function SyncBadge({ online, status }) {
  const map = {
    offline: ['오프라인', '네트워크 연결이 없습니다. 저장한 내용은 연결되면 전송됩니다.'],
    error: ['동기화 오류', '일부 캘린더를 불러오지 못했습니다.'],
    pending: ['동기화 중', '변경 내용을 서버에 저장하는 중입니다.'],
    loading: ['불러오는 중', '일정을 불러오는 중입니다.'],
    ok: ['동기화됨', '모든 변경 사항이 실시간으로 반영되고 있습니다.'],
  };
  const key = !online ? 'offline' : status;
  return <span className={`sync sync-${key}`} title={map[key][1]} aria-label={map[key][0]}><span className="sync-dot" /><span className="sync-text">{map[key][0]}</span></span>;
}

export function Sidebar({
  user, profile, calendars, subscriptions, focus, setFocus, hiddenIds, toggleHidden, statusByCal,
  onNewCalendar, onOpenSettings, onOpenCalendar, invitationsCount, onOpenInvitations, ddayItems, overflowIds, open, onCloseMobile,
}) {
  const subsCountByTarget = useMemo(() => {
    const m = new Map();
    for (const s of subscriptions) if (s.active) m.set(s.targetCalendarId, (m.get(s.targetCalendarId) || 0) + 1);
    return m;
  }, [subscriptions]);
  const focused = calendars.find((c) => c.id === focus);
  // 모바일: 사이드바에서 대화상자를 열면 사이드바는 닫는다.
  const andClose = (fn) => (...args) => { onCloseMobile(); fn(...args); };
  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onCloseMobile} />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="캘린더 목록">
        <div className="profile">
          <Avatar name={profile?.displayName || user.displayName} photoURL={user.photoURL} size={36} />
          <div className="profile-main">
            <b>{profile?.displayName || user.displayName}</b>
            <span className="muted small">{user.email}</span>
          </div>
          <button className="icon-btn" onClick={andClose(onOpenSettings)} aria-label="설정">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
          </button>
        </div>

        {invitationsCount > 0 && (
          <button className="invite-banner" onClick={andClose(onOpenInvitations)}>📩 받은 초대 {invitationsCount}건</button>
        )}

        {focused && (
          <div className="focus-cover" style={coverStyle(focused.coverImage, focused.color)}>
            <span>{focused.name}</span>
            <Torn />
          </div>
        )}

        <nav className="cal-nav">
          <button className={`cal-item all ${focus === 'all' ? 'active' : ''}`} onClick={() => { setFocus('all'); onCloseMobile(); }}>
            <span className="cal-color multi" />
            <span className="cal-name">통합 보기</span>
            <span className="muted small">{calendars.length - hiddenIds.filter((id) => calendars.some((c) => c.id === id)).length}개 표시</span>
          </button>
          <div className="cal-section-title">
            <span>MY CALENDARS</span>
            <button className="icon-btn" onClick={andClose(onNewCalendar)} aria-label="새 캘린더">＋</button>
          </div>
          {calendars.length === 0 && <p className="muted small pad">캘린더가 없습니다. ＋ 를 눌러 만드세요.</p>}
          {calendars.map((c) => {
            const role = roleOf(c, user.uid);
            const st = statusByCal.get(c.id);
            const hidden = hiddenIds.includes(c.id);
            return (
              <div key={c.id} className={`cal-item ${focus === c.id ? 'active' : ''}`}>
                <button className="cal-eye" onClick={() => toggleHidden(c.id)} aria-label={hidden ? '통합 보기에 표시' : '통합 보기에서 숨기기'} title={hidden ? '통합 보기에 표시' : '통합 보기에서 숨기기'}>
                  <span className="cal-color" style={hidden ? { border: `2px solid ${c.color}`, background: 'transparent' } : { background: c.color }} />
                </button>
                <button className="cal-name-btn" onClick={() => { setFocus(c.id); onCloseMobile(); }}>
                  <span className={`cal-name ${hidden ? 'muted' : ''}`}>{c.shared ? '' : '🔒 '}{c.name}</span>
                  <span className="muted small">
                    {ROLE_LABELS[role]}{c.shared ? ` · ${c.memberIds.length}명` : ''}{subsCountByTarget.get(c.id) ? ` · 🔗${subsCountByTarget.get(c.id)}` : ''}
                    {st?.state === 'error' ? ' · ⚠ 오류' : ''}{overflowIds.includes(c.id) ? ' · 표시 한도 초과' : ''}
                  </span>
                </button>
                <button className="icon-btn" onClick={andClose(() => onOpenCalendar(c.id))} aria-label={`${c.name} 설정`}>⋯</button>
              </div>
            );
          })}
        </nav>

        <div className="dday-panel">
          <div className="cal-section-title"><span>D-DAY ♡</span></div>
          {ddayItems.length === 0 && <p className="muted small pad">기념일을 등록하면 여기에 표시됩니다.</p>}
          {ddayItems.map((d) => (
            <div key={d.key} className="dday-item">
              <span className="dot" style={{ background: d.color }} />
              <span className="dday-title">{d.title}</span>
              <span className="dday-val">{d.label}</span>
              {d.sub && <span className="muted small dday-sub">{d.sub}</span>}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

/** 사이드바의 기념일·D-day 목록 (현재 불러온 일정 기준) */
export function useDdayItems(eventsByCal, calendarsById, sources, tz, uid) {
  return useMemo(() => {
    const today = todayISO(tz);
    const out = [];
    for (const src of sources) {
      const cal = calendarsById.get(src.calendarId);
      for (const ev of eventsByCal.get(src.calendarId) || []) {
        if (ev.kind !== 'anniversary' && !ev.showDday) continue;
        if (ev.visibility === 'busy' && ev.createdBy !== uid) continue;
        const title = ev.title || '(시간만 공개)';
        if (ev.kind === 'anniversary') {
          const s = anniversarySummary(ev, tz);
          out.push({
            key: `${src.calendarId}/${ev.id}`, title, color: ev.color || cal?.color,
            label: s.countLabel,
            sub: `${s.nextYearly.years > 0 ? `${s.nextYearly.years}주년 ` : ''}${s.nextYearlyLabel}${s.milestone ? ` · ${s.milestone.days}일 ${ddayLabel(s.milestone.date, today)}` : ''}`,
            sort: 0,
          });
        } else {
          // 다음 회차(반복 포함)까지 남은 날짜
          const range = { startDate: today, endDate: addDays(today, 400), startMs: Date.parse(`${today}T00:00:00Z`) - 86400e3, endMs: Date.parse(`${addDays(today, 400)}T00:00:00Z`) };
          const next = expandEvent(ev, range)[0];
          if (!next) continue;
          const date = ev.allDay ? next.startDate : msToDate(next.startMs, tz);
          out.push({ key: `${src.calendarId}/${ev.id}`, title, color: ev.color || cal?.color, label: ddayLabel(date, today), sub: date, sort: 1, date });
        }
      }
    }
    return out.sort((a, b) => a.sort - b.sort || (a.date || '').localeCompare(b.date || ''));
  }, [eventsByCal, calendarsById, sources, tz, uid]);
}

export function SettingsDialog({ user, profile, onClose }) {
  const { write } = useUi();
  const [s, setS] = useState(profile.settings);
  const set = (k, v) => setS((cur) => ({ ...cur, [k]: v }));
  const notifSupported = typeof Notification !== 'undefined';
  return (
    <Modal title="설정" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>닫기</button><button className="btn btn-primary" onClick={async () => {
        if (await write(updateSettings(db, user.uid, s), '설정을 저장했습니다.') !== 'error') onClose();
      }}>저장</button></>}>
      <div className="form">
        <label className="field"><span>화면 모드</span>
          <select value={s.theme} onChange={(e) => set('theme', e.target.value)}>
            <option value="system">시스템 설정 따르기</option>
            <option value="light">라이트</option>
            <option value="dark">다크</option>
          </select>
        </label>
        <div className="field"><span>달력 선</span>
          <div className="seg">
            <button type="button" className={(s.gridStyle || 'classic') === 'classic' ? 'on' : ''} onClick={() => set('gridStyle', 'classic')}>반듯한 선</button>
            <button type="button" className={s.gridStyle === 'sketch' ? 'on' : ''} onClick={() => set('gridStyle', 'sketch')}>손그림 선</button>
          </div>
        </div>
        <label className="field"><span>시간대</span>
          <select value={s.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
            {[...new Set([s.timeZone, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}
          </select>
          <small>달력 표시와 새 일정 입력에 이 시간대를 씁니다. 해외에 있을 때만 바꾸면 돼요.</small>
        </label>
        <div className="field"><span>한 주의 시작</span>
          <div className="seg">
            <button type="button" className={Number(s.weekStartsOn) === 0 ? 'on' : ''} onClick={() => set('weekStartsOn', 0)}>일요일 시작</button>
            <button type="button" className={Number(s.weekStartsOn) === 1 ? 'on' : ''} onClick={() => set('weekStartsOn', 1)}>월요일 시작</button>
          </div>
        </div>
        <label className="field"><span>기본 보기</span>
          <select value={s.defaultView} onChange={(e) => set('defaultView', e.target.value)}>
            <option value="month">월간</option><option value="week">주간</option><option value="day">일간</option><option value="list">목록</option>
          </select>
        </label>
        <fieldset className="fieldset">
          <legend>알림</legend>
          <label className="check">
            <input type="checkbox" checked={s.notifications?.enabled} disabled={!notifSupported} onChange={async (e) => {
              const enabled = e.target.checked;
              if (enabled && Notification.permission !== 'granted') {
                const p = await Notification.requestPermission();
                if (p !== 'granted') return;
              }
              set('notifications', { ...s.notifications, enabled });
            }} /> 일정 알림 받기
          </label>
          <label className="field"><span>새 일정 기본 알림</span>
            <select value={s.notifications?.defaultMinutes ?? ''} onChange={(e) => set('notifications', { ...s.notifications, defaultMinutes: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">없음</option><option value={0}>시작 시</option><option value={10}>10분 전</option><option value={30}>30분 전</option><option value={60}>1시간 전</option><option value={1440}>하루 전</option>
            </select>
          </label>
          <small>{notifSupported ? '알림은 앱이 열려 있을 때만 울립니다(서버 푸시 미구현). iPhone은 홈 화면에 추가한 앱에서만 알림 권한을 요청할 수 있습니다.' : '이 브라우저는 알림을 지원하지 않습니다.'}</small>
        </fieldset>
        <button className="btn btn-danger" onClick={() => logout()}>로그아웃</button>
      </div>
    </Modal>
  );
}
