import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { loadHolidayYears, subscribeHolidays, holidaysVersion } from './lib/holidays.js';
import { DateTime } from 'luxon';
import { db, isConfigured, signInWithGoogle, usingEmulators, logout } from './firebase.js';
import { useAuthState } from './hooks/useAuthState.js';
import { useOnline } from './hooks/useOnline.js';
import { useEventFeed, useMySecrets } from './hooks/useEventFeed.js';
import { UiProvider, useUi, Spinner, ErrorBoundary, Torn, Hearts, SketchFilter } from './components/ui.jsx';
import { DayNotes, MonthMemo } from './components/Notes.jsx';
import { coverStyle } from './lib/colors.js';
import { MonthView, TimeGridView, ListView } from './components/Views.jsx';
import { EventEditor } from './components/EventEditor.jsx';
import { EventDetail } from './components/EventDetail.jsx';
import { NewCalendarDialog, CalendarSettingsDialog, InvitationsDialog } from './components/CalendarDialogs.jsx';
import { Sidebar, SyncBadge, SettingsDialog, useDdayItems } from './components/Shell.jsx';
import { listenProfile, updateSettings, DEFAULT_SETTINGS } from './services/users.js';
import { listenMyCalendars, canEdit } from './services/calendars.js';
import { listenMySubscriptions } from './services/subscriptions.js';
import { listenMyInvitations } from './services/invitations.js';
import { friendlyError } from './services/errors.js';
import { parseJoinParam, getInviteLink, joinWithLink } from './services/inviteLinks.js';
import { Modal } from './components/ui.jsx';
import { ROLE_LABELS } from './services/calendars.js';

// ── 초대 링크(?join=) : 로그인(리디렉션 포함)을 거쳐도 잊지 않도록 sessionStorage 에 보관 ──
const JOIN_KEY = 'pendingJoin';
(function captureJoinParam() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const join = parseJoinParam(params.get('join'));
  if (!join) return;
  try { sessionStorage.setItem(JOIN_KEY, JSON.stringify(join)); } catch { /* 저장소 사용 불가 */ }
  params.delete('join');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  window.__pendingJoin = join;
}());
function readPendingJoin() {
  try { return JSON.parse(sessionStorage.getItem(JOIN_KEY)) || window.__pendingJoin || null; } catch { return window.__pendingJoin || null; }
}
function clearPendingJoin() {
  try { sessionStorage.removeItem(JOIN_KEY); } catch { /* 무시 */ }
  window.__pendingJoin = null;
}

function JoinDialog({ user, link, onJoined, onClose }) {
  const { write } = useUi();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="캘린더 초대" onClose={onClose} small>
      <div className="join-card">
        <Hearts />
        <p className="muted">{link.createdByName}님이 초대했어요</p>
        <div className="join-name">{link.calendarName}</div>
        <p><span className="dot" style={{ background: link.calendarColor }} /> {ROLE_LABELS[link.role]}로 참여합니다
          <br /><span className="muted small">{link.role === 'editor' ? '일정을 보고, 추가·수정할 수 있어요.' : '일정을 볼 수 있어요.'}</span></p>
        <div className="btn-col" style={{ width: '100%' }}>
          <button className="btn btn-primary" disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await write(joinWithLink(db, user, link.calendarId, link.id, link.role), `${link.calendarName}에 참여했습니다.`);
            setBusy(false);
            if (r !== 'error') onJoined(link.calendarId);
          }}>{busy ? '참여하는 중…' : '참여하기'}</button>
          <button className="btn" onClick={onClose}>다음에</button>
        </div>
      </div>
    </Modal>
  );
}
import { resolveFeedSources, buildInstances } from './lib/feed.js';
import { viewRange, todayISO, safeZone, addDays, dateToDT } from './lib/time.js';

export default function App() {
  if (!isConfigured) return <SetupNotice />;
  return <ErrorBoundary><UiProvider><Root /></UiProvider></ErrorBoundary>;
}

function SetupNotice() {
  return (
    <div className="center-screen">
      <div className="card">
        <h1>Firebase 설정이 필요합니다</h1>
        <p><code>.env.example</code> 파일을 <code>.env.local</code> 로 복사하고 Firebase 웹 앱 설정 값을 채운 뒤 다시 실행하세요.</p>
        <p>실제 프로젝트 없이 체험하려면 <code>npm run emulators</code> 와 <code>npm run dev:emu</code> 를 실행하세요.</p>
      </div>
    </div>
  );
}

function Root() {
  const { user, loading, error, profileReady } = useAuthState();
  if (loading) return <div className="center-screen"><Spinner label="로그인 상태 확인 중…" /></div>;
  if (!user) return <Login error={error} />;
  if (!profileReady) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>프로필을 준비하지 못했습니다</h1>
          <p className="form-error">{error || '알 수 없는 오류'}</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>다시 시도</button>
            <button className="btn" onClick={() => logout()}>로그아웃</button>
          </div>
        </div>
      </div>
    );
  }
  return <Main user={user} />;
}

function Login({ error }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="center-screen login">
      <div className="card">
        <div className="login-year">{new Date().getFullYear()}</div>
        <Hearts />
        <h1 className="login-title">Calendar</h1>
        {readPendingJoin() && <p className="hint">💌 캘린더 초대를 받았어요! 로그인하면 바로 참여할 수 있어요.</p>}
        <hr className="login-rule" />
        <p className="login-sub">우리의 하루를 함께 적는 작은 종이 달력.<br />나만의 달력부터 연인·가족·친구와 함께 쓰는 달력까지.</p>
        <button className="btn btn-google" disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { await signInWithGoogle(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
        }}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
          {busy ? '로그인 중…' : 'Google 계정으로 로그인'}
        </button>
        {(err || error) && <p className="form-error" role="alert">{err || error}</p>}
        {usingEmulators && <p className="hint">에뮬레이터 모드: 실제 Google 계정 대신 테스트 계정 화면이 열립니다.</p>}
      </div>
    </div>
  );
}

function rangeForList(from, to, tz) {
  return {
    startDate: from,
    endDate: to,
    startMs: dateToDT(from, tz).toMillis(),
    endMs: dateToDT(addDays(to, 1), tz).toMillis(),
  };
}

function useReminders(instances, settings, tz) {
  const fired = useRef(new Set());
  const { toast } = useUi();
  useEffect(() => {
    if (!settings?.notifications?.enabled) return undefined;
    const now = Date.now();
    const timers = [];
    for (const inst of instances) {
      const mins = inst.ev.reminders?.[0];
      if (mins === undefined || mins === null || inst.hiddenDetails) continue;
      const startMs = inst.allDay ? DateTime.fromISO(inst.startDate, { zone: tz }).set({ hour: 9 }).toMillis() : inst.startMs;
      const fireAt = startMs - mins * 60000;
      if (fireAt <= now || fireAt - now > 24 * 3600e3 || fired.current.has(inst.key)) continue;
      timers.push(setTimeout(() => {
        fired.current.add(inst.key);
        const body = `${inst.calendarName} · ${mins === 0 ? '지금 시작' : `${mins}분 후 시작`}`;
        toast('info', `🔔 ${inst.title} — ${body}`, 10000);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const show = (reg) => (reg ? reg.showNotification(inst.title, { body, tag: inst.key }) : new Notification(inst.title, { body, tag: inst.key }));
          if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then(show).catch(() => show(null));
          else try { show(null); } catch { /* 일부 모바일 브라우저는 생성자 미지원 */ }
        }
      }, fireAt - now));
    }
    return () => timers.forEach(clearTimeout);
  }, [instances, settings?.notifications?.enabled, tz, toast]);
}

function Main({ user }) {
  const { toast } = useUi();
  const online = useOnline();
  const [profile, setProfile] = useState(null);
  const [calendars, setCalendars] = useState(null);
  const [calMeta, setCalMeta] = useState({ hasPendingWrites: false });
  const [subscriptions, setSubscriptions] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [invError, setInvError] = useState('');
  const [listenError, setListenError] = useState('');

  useEffect(() => listenProfile(db, user.uid, setProfile, (e) => setListenError(friendlyError(e))), [user.uid]);
  useEffect(() => listenMyCalendars(db, user.uid, (list, meta) => { setCalendars(list); setCalMeta(meta); }, (e) => setListenError(friendlyError(e))), [user.uid]);
  useEffect(() => listenMySubscriptions(db, user.uid, setSubscriptions, (e) => setListenError(friendlyError(e))), [user.uid]);
  useEffect(() => listenMyInvitations(db, user, setInvitations, (e) => setInvError(friendlyError(e))), [user]);

  const settings = { ...DEFAULT_SETTINGS, ...(profile?.settings || {}) };
  const tz = safeZone(settings.timeZone);

  // 화면 모드 (라이트/다크)
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'system' ? '' : settings.theme;
  }, [settings.theme]);

  const [view, setView] = useState(null);
  useEffect(() => { if (profile && !view) setView(settings.defaultView || 'month'); }, [profile, view, settings.defaultView]);
  const [anchor, setAnchor] = useState(() => todayISO(tz));
  const [focus, setFocusState] = useState(() => { try { return localStorage.getItem('focus') || 'all'; } catch { return 'all'; } });
  const setFocus = (f) => { setFocusState(f); try { localStorage.setItem('focus', f); } catch { /* 저장소 사용 불가 */ } };
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => todayISO(tz));
  const [listFrom, setListFrom] = useState(() => todayISO(tz));
  const [listTo, setListTo] = useState(() => addDays(todayISO(tz), 30));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // {type, ...}
  const [pendingFocus, setPendingFocus] = useState(null);

  // 표시 중이던 캘린더에 접근할 수 없게 되면 통합 보기로
  useEffect(() => {
    if (calendars && pendingFocus && calendars.some((c) => c.id === pendingFocus)) {
      setFocus(pendingFocus);
      setPendingFocus(null);
      return;
    }
    if (calendars && focus !== 'all' && !calendars.some((c) => c.id === focus)) setFocus('all');
  }, [calendars, focus, pendingFocus]);

  // 초대 링크로 들어온 경우: 로그인 후 참여 화면 표시
  const joinChecked = useRef(false);
  useEffect(() => {
    if (!calendars || joinChecked.current) return;
    joinChecked.current = true;
    const join = readPendingJoin();
    if (!join) return;
    if (calendars.some((c) => c.id === join.calId)) {
      clearPendingJoin();
      setFocus(join.calId);
      toast('info', '이미 참여 중인 캘린더예요.');
      return;
    }
    getInviteLink(db, join.calId, join.linkId)
      .then((link) => setDialog({ type: 'join', link }))
      .catch((e) => { clearPendingJoin(); toast('error', friendlyError(e), 6000); });
  }, [calendars]);

  const hiddenIds = settings.hiddenCalendarIds || [];
  const toggleHidden = useCallback((id) => {
    const next = hiddenIds.includes(id) ? hiddenIds.filter((x) => x !== id) : [...hiddenIds, id];
    updateSettings(db, user.uid, { ...settings, hiddenCalendarIds: next }).catch((e) => toast('error', friendlyError(e)));
  }, [hiddenIds, settings, user.uid, toast]);

  const currentView = view || 'month';
  const range = useMemo(() => (currentView === 'list'
    ? rangeForList(listFrom, listTo < listFrom ? listFrom : listTo, tz)
    : viewRange(currentView, anchor, tz, settings.weekStartsOn)), [currentView, anchor, tz, settings.weekStartsOn, listFrom, listTo]);

  // 공휴일 자동 갱신: 보고 있는 해와 앞뒤 해를 받아 오고, 도착하면 다시 그린다.
  useSyncExternalStore(subscribeHolidays, holidaysVersion);
  const viewYear = Number((currentView === 'list' ? listFrom : anchor).slice(0, 4));
  useEffect(() => { loadHolidayYears([viewYear - 1, viewYear, viewYear + 1]); }, [viewYear]);

  const calList = calendars || [];
  const calendarsById = useMemo(() => new Map(calList.map((c) => [c.id, c])), [calList]);
  const feed = useMemo(() => resolveFeedSources({ calendars: calList, subscriptions, focus, hiddenIds }), [calList, subscriptions, focus, hiddenIds]);
  const ids = useMemo(() => feed.sources.map((s) => s.calendarId), [feed]);
  const { eventsByCal, statusByCal } = useEventFeed(db, user.uid, ids, range);
  const secrets = useMySecrets(db, user.uid, eventsByCal);
  const instances = useMemo(() => buildInstances({
    eventsByCal, sources: feed.sources, calendarsById, range, uid: user.uid, tz, secrets, search,
  }), [eventsByCal, feed.sources, calendarsById, range, user.uid, tz, secrets, search]);
  const ddayItems = useDdayItems(eventsByCal, calendarsById, feed.sources, tz, user.uid);
  useReminders(instances, settings, tz);

  // 동기화 상태
  const statuses = ids.map((id) => statusByCal.get(id)).filter(Boolean);
  const syncStatus = statuses.some((s) => s.state === 'error') || listenError ? 'error'
    : (!calendars || statuses.length < ids.length || statuses.some((s) => s.state === 'loading')) ? 'loading'
      : (statuses.some((s) => s.pending) || calMeta.hasPendingWrites) ? 'pending' : 'ok';
  const errorCals = ids.filter((id) => statusByCal.get(id)?.state === 'error');
  const authExpired = [...statusByCal.values()].some((s) => s.code === 'unauthenticated');

  const editableCalendars = calList.filter((c) => canEdit(c, user.uid));
  const today = todayISO(tz);

  function move(dir) {
    if (currentView === 'list') {
      const span = Math.max(1, Math.round((Date.parse(listTo) - Date.parse(listFrom)) / 86400e3) + 1);
      setListFrom(addDays(listFrom, dir * span));
      setListTo(addDays(listTo, dir * span));
      return;
    }
    const dt = DateTime.fromISO(anchor);
    const next = currentView === 'month' ? dt.plus({ months: dir }).startOf('month')
      : currentView === 'week' ? dt.plus({ weeks: dir }) : dt.plus({ days: dir });
    setAnchor(next.toISODate());
    setSelectedDate(currentView === 'month' ? (next.toISODate().slice(0, 7) === today.slice(0, 7) ? today : next.startOf('month').toISODate()) : next.toISODate());
  }

  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const anchorDT = DateTime.fromISO(anchor).setLocale('ko');
  function subtitle() {
    if (currentView === 'week') {
      const st = DateTime.fromISO(range.startDate).setLocale('ko');
      const en = DateTime.fromISO(range.endDate).setLocale('ko');
      return `${st.toFormat('M월 d일')} – ${en.toFormat(st.month === en.month ? 'd일' : 'M월 d일')}`;
    }
    if (currentView === 'day') return anchorDT.toFormat('M월 d일 cccc');
    if (currentView === 'list') return '일정 목록';
    return `${anchorDT.month}월`;
  }
  function goToday() {
    setAnchor(today);
    setSelectedDate(today);
    if (currentView === 'list') { setListFrom(today); setListTo(addDays(today, 30)); }
  }

  function openCreate(date, hour) {
    if (!editableCalendars.length) {
      toast('error', '일정을 추가할 수 있는 캘린더가 없습니다. 새 캘린더를 만들거나 편집 권한을 요청하세요.');
      return;
    }
    const target = editableCalendars.find((c) => c.id === focus) || editableCalendars[0];
    const d = date || (anchor.slice(0, 7) === today.slice(0, 7) ? today : anchor);
    const h = hour ?? Math.min(22, DateTime.now().setZone(tz).hour + 1);
    const start = DateTime.fromISO(d, { zone: tz }).set({ hour: h, minute: 0 });
    setDialog({
      type: 'editor', mode: 'create',
      defaults: {
        calendarId: target.id, allDay: false, startDate: d, timeZone: tz,
        startMs: start.toMillis(), endMs: start.plus({ hours: 1 }).toMillis(),
        reminder: settings.notifications?.defaultMinutes == null ? '' : String(settings.notifications.defaultMinutes),
      },
    });
  }

  function openEdit(inst, secret) {
    const occ = inst.occKey ? (inst.allDay
      ? { startDate: inst.startDate, endDate: inst.endDate }
      : { startMs: inst.startMs, endMs: inst.endMs }) : null;
    setDialog({
      type: 'editor', mode: 'edit',
      existing: { calendarId: inst.calendarId, eventId: inst.eventId, ev: inst.ev, occKey: inst.occKey, occ, secret },
      defaults: { calendarId: inst.calendarId, timeZone: tz, allDay: inst.allDay, startDate: inst.startDate, startMs: inst.startMs, endMs: inst.endMs },
    });
  }

  const focusedCal = calendarsById.get(focus);
  const emptyText = search ? `"${search}"에 맞는 일정이 이 기간에 없습니다.` : '이 기간에 일정이 없습니다.';

  if (!calendars || !profile) return <div className="center-screen"><Spinner label="캘린더 불러오는 중…" /></div>;

  const monthName = MONTHS_EN[(currentView === 'list' ? DateTime.fromISO(listFrom) : anchorDT).month - 1];
  const viewName = { month: '월', week: '주', day: '일', list: '목록' };
  const showCover = focusedCal && focusedCal.coverImage && currentView === 'month';

  return (
    <div className="app">
      <SketchFilter />
      <Sidebar
        user={user} profile={profile} calendars={calList} subscriptions={subscriptions}
        focus={focus} setFocus={setFocus} hiddenIds={hiddenIds} toggleHidden={toggleHidden} statusByCal={statusByCal}
        onNewCalendar={() => setDialog({ type: 'newCal' })}
        onOpenSettings={() => setDialog({ type: 'settings' })}
        onOpenCalendar={(id) => setDialog({ type: 'calSettings', calId: id })}
        invitationsCount={invitations.length} onOpenInvitations={() => setDialog({ type: 'invites' })}
        ddayItems={ddayItems} overflowIds={feed.overflow.map((s) => s.calendarId)}
        open={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)}
      />
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(true)} aria-label="캘린더 메뉴">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h11M4 17h16" /></svg>
            {invitations.length > 0 && <span className="badge-dot" />}
          </button>
          <div className="topbar-center">
            <span className="topbar-year">{(currentView === 'list' ? DateTime.fromISO(listFrom) : anchorDT).year}</span>
            <Hearts />
          </div>
          <SyncBadge online={online} status={syncStatus} />
          <button className="icon-btn" onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setSearch(''); }} aria-label="검색 열기" aria-expanded={searchOpen}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
          </button>
        </header>
        {searchOpen && (
          <div className="searchbar">
            <input type="search" autoFocus placeholder="제목, 장소, 메모로 검색" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="일정 검색" />
          </div>
        )}

        <div className="sheet-col">
          {showCover && (
            <div className="cover-banner" style={coverStyle(focusedCal.coverImage, focusedCal.color)}>
              <div className="cover-title"><span className="small">{!focusedCal.shared ? '나만의 달력' : focusedCal.memberIds.length > 1 ? `${focusedCal.memberIds.length}명이 함께 쓰는 달력` : '함께 쓸 사람을 초대해 보세요'}</span><b>{focusedCal.name}</b></div>
              <Torn />
            </div>
          )}

          <div className={`masthead ${currentView === 'month' ? '' : 'compact'}`}>
            <h1 className="month-name">{monthName}</h1>
            <div className="masthead-sub">
              <span>{subtitle()}</span>
              <span aria-hidden>·</span>
              <button className="cal-switch" onClick={() => setSidebarOpen(true)}>
                <span className="dot" style={{ background: focusedCal?.color || 'var(--ink)' }} />
                {focusedCal ? focusedCal.name : `통합 보기 (${feed.sources.length})`}
                <span className="chev">▼</span>
              </button>
            </div>
          </div>

          <div className="controls">
            <div className="nav-group">
              <button className="icon-btn" onClick={() => move(-1)} aria-label="이전"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg></button>
              <button className="btn btn-small" onClick={goToday}>오늘</button>
              <button className="icon-btn" onClick={() => move(1)} aria-label="다음"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg></button>
            </div>
            <div className="seg view-seg" role="tablist" aria-label="보기 방식">
              {Object.entries(viewName).map(([v, l]) => (
                <button key={v} role="tab" aria-selected={currentView === v} className={currentView === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>
              ))}
            </div>
          </div>

          {(focus !== 'all' || currentView === 'list') && (
            <div className="context-bar">
              {focus !== 'all' && feed.sources.filter((s) => s.subscribed).length > 0 && (
                <span>구독 {feed.sources.filter((s) => s.subscribed).map((s) => (
                  <span key={s.calendarId} className="legend-chip" style={{ '--c': calendarsById.get(s.calendarId)?.color }}>🔗 {calendarsById.get(s.calendarId)?.name}</span>
                ))}</span>
              )}
              {focus !== 'all' && <button className="link" onClick={() => setDialog({ type: 'calSettings', calId: focus, tab: 'subs' })}>구독 관리</button>}
              {focusedCal?.shared && focusedCal.ownerId === user.uid && <button className="link" onClick={() => setDialog({ type: 'calSettings', calId: focus, tab: 'invites' })}>초대</button>}
              {currentView === 'list' && (
                <span className="list-range">
                  <input type="date" value={listFrom} onChange={(e) => setListFrom(e.target.value)} aria-label="시작일" />
                  ~
                  <input type="date" value={listTo} min={listFrom} max={addDays(listFrom, 366)} onChange={(e) => setListTo(e.target.value)} aria-label="종료일" />
                </span>
              )}
            </div>
          )}

          {authExpired && <div className="banner banner-error">로그인이 만료되었습니다. <button className="link" onClick={() => logout()}>다시 로그인</button></div>}
          {listenError && <div className="banner banner-error">{listenError}</div>}
          {errorCals.length > 0 && (
            <div className="banner banner-error">
              {errorCals.map((id) => calendarsById.get(id)?.name || '알 수 없는 캘린더').join(', ')}: {statusByCal.get(errorCals[0])?.error}
            </div>
          )}
          {feed.inaccessible.length > 0 && (
            <div className="banner">접근 권한이 없어진 구독 {feed.inaccessible.length}개는 표시하지 않습니다. 캘린더 설정 &gt; 구독에서 해제할 수 있습니다.</div>
          )}
          {feed.overflow.length > 0 && (
            <div className="banner">한 번에 실시간으로 표시할 수 있는 캘린더는 {feed.sources.length}개입니다. 일부 캘린더를 숨기면 나머지가 표시됩니다.</div>
          )}
          {!online && <div className="banner">오프라인이에요. 마지막으로 받은 내용을 보여 주고, 고친 내용은 연결되면 보내요.</div>}
          {search && <div className="banner">"{search}" 검색 결과 {instances.length}개 (이 기간 안에서)</div>}

          {calList.length === 0 ? (
            <div className="empty">
              <p>아직 캘린더가 없어요.</p>
              <button className="btn btn-primary" onClick={() => setDialog({ type: 'newCal' })}>캘린더 만들기</button>
            </div>
          ) : currentView === 'month' ? (
            <>
              <MonthView range={range} anchorDate={anchor} instances={instances} today={today} tz={tz} weekStartsOn={settings.weekStartsOn}
                selectedDate={selectedDate} sketch={settings.gridStyle === 'sketch'}
                onOpen={(inst) => setDialog({ type: 'detail', inst })}
                onSelectDate={setSelectedDate}
                onCreateAt={(d) => openCreate(d)}
                onSwipe={move} />
              <div className="notes-grid">
                <DayNotes date={selectedDate} instances={instances} tz={tz}
                  onOpen={(inst) => setDialog({ type: 'detail', inst })} onCreate={(d) => openCreate(d)} />
                <MonthMemo user={user} calendar={focusedCal || null} month={anchor.slice(0, 7)} />
              </div>
            </>
          ) : currentView === 'list' ? (
            <ListView instances={instances} range={range} today={today} tz={tz} emptyText={emptyText}
              onOpen={(inst) => setDialog({ type: 'detail', inst })} />
          ) : (
            <TimeGridView
              days={Array.from({ length: currentView === 'week' ? 7 : 1 }, (_, i) => addDays(range.startDate, i))}
              instances={instances} today={today} tz={tz}
              onOpen={(inst) => setDialog({ type: 'detail', inst })}
              onCreateAt={(d, h) => openCreate(d, h)} onSwipe={move} />
          )}
        </div>

        <button className="fab" onClick={() => openCreate(currentView === 'month' ? selectedDate : undefined)} aria-label="새 일정">＋</button>
      </main>

      {dialog?.type === 'editor' && (
        <EventEditor mode={dialog.mode} user={user} editableCalendars={editableCalendars}
          existing={dialog.existing} defaults={dialog.defaults} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'detail' && (
        <EventDetail inst={dialog.inst} calendar={calendarsById.get(dialog.inst.calendarId)}
          viaCalendar={dialog.inst.via ? calendarsById.get(dialog.inst.via) : null}
          user={user} tz={tz} onClose={() => setDialog(null)}
          onEdit={(inst, secret) => openEdit(inst, secret)} />
      )}
      {dialog?.type === 'newCal' && <NewCalendarDialog user={user} defaultColorIndex={calList.length} onClose={() => setDialog(null)} onCreated={(id) => id && setFocus(id)} />}
      {dialog?.type === 'calSettings' && (
        <CalendarSettingsDialog cal={calendarsById.get(dialog.calId)} user={user} calendars={calList}
          subscriptions={subscriptions} initialTab={dialog.tab} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'join' && (
        <JoinDialog user={user} link={dialog.link}
          onJoined={(calId) => { clearPendingJoin(); setPendingFocus(calId); setDialog(null); }}
          onClose={() => { clearPendingJoin(); setDialog(null); }} />
      )}
      {dialog?.type === 'invites' && <InvitationsDialog user={user} invitations={invitations} error={invError} onClose={() => setDialog(null)} />}
      {dialog?.type === 'settings' && <SettingsDialog user={user} profile={{ ...profile, settings }} onClose={() => setDialog(null)} />}
    </div>
  );
}
