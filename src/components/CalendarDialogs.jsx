import { useEffect, useState } from 'react';
import { Modal, Avatar, ColorPicker, useUi, Torn } from './ui.jsx';
import { db } from '../firebase.js';
import { PALETTE, COVER_PRESETS, coverStyle, resizeImage } from '../lib/colors.js';
import {
  createCalendar, updateCalendarSettings, changeMemberRole, removeMember, leaveCalendar,
  transferOwnership, deleteCalendar, roleOf, ROLE_LABELS,
} from '../services/calendars.js';
import {
  inviteMember, cancelInvitation, deleteInvitation, listenCalendarInvitations, INVITE_STATUS_LABELS,
  acceptInvitation, declineInvitation,
} from '../services/invitations.js';
import { subscribe, unsubscribe, setSubscriptionActive } from '../services/subscriptions.js';
import { createInviteLink, listenInviteLinks, deleteInviteLink, inviteUrl, LINK_DAYS } from '../services/inviteLinks.js';
import { subscriptionStatus } from '../lib/feed.js';
import { friendlyError } from '../services/errors.js';

function CoverPicker({ value, color, onChange }) {
  const { toast } = useUi();
  return (
    <div className="field">
      <span>커버</span>
      <div className="cover-preview" style={coverStyle(value, color)}><Torn /></div>
      <div className="cover-presets">
        <button type="button" className={`cover-opt ${!value ? 'selected' : ''}`} style={coverStyle('', color)} onClick={() => onChange('')} aria-label="대표 색상" title="대표 색상" />
        {COVER_PRESETS.map((p, i) => (
          <button type="button" key={p.name} className={`cover-opt ${value === `preset:${i}` ? 'selected' : ''}`} style={p.css}
            onClick={() => onChange(`preset:${i}`)} aria-label={`커버 ${p.name}`} title={p.name} />
        ))}
        <label className="btn btn-small">
          사진 선택
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { onChange(await resizeImage(f)); } catch (err) { toast('error', err.message); }
          }} />
        </label>
      </div>
      <small>커버는 달력 맨 위에 찢어진 종이처럼 표시됩니다. 사진은 1200×400 크기로 줄여 저장합니다.</small>
    </div>
  );
}

export function NewCalendarDialog({ user, defaultColorIndex = 1, onClose, onCreated }) {
  const { write } = useUi();
  const [f, setF] = useState({ name: '', description: '', color: PALETTE[defaultColorIndex % PALETTE.length], coverImage: 'preset:0', shared: true });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) { setErr('이름을 입력하세요.'); return; }
    setSaving(true);
    let id;
    const op = createCalendar(db, user, f).then((x) => { id = x; });
    const r = await write(op, '캘린더를 만들었습니다.');
    setSaving(false);
    if (r !== 'error') { onCreated?.(id); onClose(); }
  }
  return (
    <Modal title="새 캘린더" onClose={onClose}
      footer={<>{err && <span className="form-error">{err}</span>}<button className="btn" onClick={onClose}>취소</button><button className="btn btn-primary" form="newcal" disabled={saving}>{saving ? '만드는 중…' : '만들기'}</button></>}>
      <form id="newcal" className="form" onSubmit={submit}>
        <label className="field"><span>이름</span><input autoFocus maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 커플 캘린더, 가족, 동아리" /></label>
        <label className="field"><span>설명</span><input maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="field"><span>대표 색상</span><ColorPicker value={f.color} onChange={(c) => setF({ ...f, color: c })} palette={PALETTE} /></div>
        <div className="field">
          <span>종류</span>
          <div className="seg">
            <button type="button" className={!f.shared ? 'on' : ''} onClick={() => setF({ ...f, shared: false })}>🔒 개인 (나만)</button>
            <button type="button" className={f.shared ? 'on' : ''} onClick={() => setF({ ...f, shared: true })}>👥 공유 (초대 가능)</button>
          </div>
        </div>
        <CoverPicker value={f.coverImage} color={f.color} onChange={(v) => setF({ ...f, coverImage: v })} />
      </form>
    </Modal>
  );
}

function InfoTab({ cal, user, onClose }) {
  const { write, confirm } = useUi();
  const owner = roleOf(cal, user.uid) === 'owner';
  const [f, setF] = useState({ name: cal.name, description: cal.description, color: cal.color, coverImage: cal.coverImage, shared: cal.shared });
  const [saving, setSaving] = useState(false);
  if (!owner) {
    return (
      <div className="form">
        <div className="cover-preview" style={coverStyle(cal.coverImage, cal.color)}><Torn /></div>
        <p><b>{cal.name}</b></p>
        {cal.description && <p className="muted">{cal.description}</p>}
        <p className="hint">캘린더 설정은 소유자만 바꿀 수 있습니다.</p>
        <button className="btn btn-danger" onClick={async () => {
          const ok = await confirm({ title: '캘린더 나가기', message: `"${cal.name}"에서 나갈까요? 다시 들어오려면 소유자의 초대가 필요합니다.`, okLabel: '나가기', danger: true });
          if (!ok) return;
          if (await write(leaveCalendar(db, user, cal.id), '캘린더에서 나갔습니다.') === 'ok') onClose();
        }}>이 캘린더에서 나가기</button>
      </div>
    );
  }
  return (
    <form className="form" onSubmit={async (e) => {
      e.preventDefault();
      setSaving(true);
      let op;
      try { op = updateCalendarSettings(db, user, cal.id, f, cal); } catch (err) { op = Promise.reject(err); }
      await write(op, '캘린더 설정을 저장했습니다.');
      setSaving(false);
    }}>
      <label className="field"><span>이름</span><input maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>설명</span><input maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="field"><span>대표 색상</span><ColorPicker value={f.color} onChange={(c) => setF({ ...f, color: c })} palette={PALETTE} /></div>
      <div className="field">
        <span>종류</span>
        <div className="seg">
          <button type="button" className={!f.shared ? 'on' : ''} onClick={() => setF({ ...f, shared: false })}>🔒 개인</button>
          <button type="button" className={f.shared ? 'on' : ''} onClick={() => setF({ ...f, shared: true })}>👥 공유</button>
        </div>
        {!f.shared && cal.memberIds.length > 1 && <small className="form-error">다른 멤버가 있어 개인 캘린더로 바꿀 수 없습니다.</small>}
      </div>
      <CoverPicker value={f.coverImage} color={f.color} onChange={(v) => setF({ ...f, coverImage: v })} />
      <div className="btn-row">
        <button className="btn btn-primary" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        <button type="button" className="btn btn-danger" onClick={async () => {
          const ok = await confirm({ title: '캘린더 삭제', message: `"${cal.name}" 캘린더와 모든 일정이 모든 멤버에게서 삭제됩니다. 되돌릴 수 없습니다.`, okLabel: '영구 삭제', danger: true });
          if (!ok) return;
          if (await write(deleteCalendar(db, user, cal.id), '캘린더를 삭제했습니다.') === 'ok') onClose();
        }}>캘린더 삭제</button>
      </div>
    </form>
  );
}

function MembersTab({ cal, user }) {
  const { write, confirm } = useUi();
  const owner = roleOf(cal, user.uid) === 'owner';
  const members = cal.memberIds.map((uid) => ({ uid, ...(cal.memberInfo?.[uid] || {}), role: roleOf(cal, uid) }))
    .sort((a, b) => ['owner', 'editor', 'viewer'].indexOf(a.role) - ['owner', 'editor', 'viewer'].indexOf(b.role));
  return (
    <div>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.uid}>
            <Avatar name={m.name} photoURL={m.photoURL} size={32} />
            <span className="member-main"><b>{m.name}{m.uid === user.uid ? ' (나)' : ''}</b><span className="muted small">{m.email}</span></span>
            {owner && m.role !== 'owner' ? (
              <span className="member-actions">
                <select value={m.role} aria-label="역할" onChange={(e) => write(changeMemberRole(db, user, cal.id, m.uid, e.target.value), '역할을 변경했습니다.')}>
                  <option value="editor">편집자</option>
                  <option value="viewer">열람자</option>
                </select>
                <button className="btn btn-small" onClick={async () => {
                  const ok = await confirm({ title: '소유권 이전', message: `${m.name}님을 새 소유자로 지정할까요? 나는 편집자가 되고, 멤버 관리 권한을 잃습니다.`, okLabel: '이전', danger: true });
                  if (ok) write(transferOwnership(db, user, cal.id, m.uid), '소유권을 이전했습니다.');
                }}>소유권 이전</button>
                <button className="btn btn-small btn-danger" onClick={async () => {
                  const ok = await confirm({ title: '멤버 제거', message: `${m.name}님을 제거할까요? 즉시 이 캘린더의 일정을 볼 수 없게 됩니다.`, okLabel: '제거', danger: true });
                  if (ok) write(removeMember(db, user, cal.id, m.uid), '멤버를 제거했습니다.');
                }}>제거</button>
              </span>
            ) : <span className="role-badge">{ROLE_LABELS[m.role]}</span>}
          </li>
        ))}
      </ul>
      <p className="hint">소유자: 설정·멤버·일정 관리 / 편집자: 일정 추가·수정·삭제 / 열람자: 보기만 가능</p>
    </div>
  );
}

/** 링크 공유: 휴대폰은 공유 시트(카카오톡 등), 그 외에는 클립보드 복사 */
async function shareLink(url, calName, toast) {
  const text = `"${calName}" 캘린더에 초대합니다. 링크를 눌러 Google 계정으로 로그인하면 바로 참여할 수 있어요.`;
  if (navigator.share) {
    try { await navigator.share({ title: `${calName} 캘린더 초대`, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('success', '링크를 복사했습니다. 카카오톡 등에 붙여 넣어 보내세요.');
  } catch {
    window.prompt('아래 링크를 복사하세요', url);
  }
}

function InviteLinkSection({ cal, user }) {
  const { write, toast, confirm } = useUi();
  const [links, setLinks] = useState(null);
  const [role, setRole] = useState('editor');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  useEffect(() => listenInviteLinks(db, cal.id, setLinks, () => setLinks([])), [cal.id]);
  const now = Date.now();
  const active = (links || []).filter((l) => l.expiresAt?.toMillis?.() > now)
    .sort((a, b) => b.expiresAt.toMillis() - a.expiresAt.toMillis());
  return (
    <section className="link-invite">
      <div className="note-head"><h2>링크로 초대</h2><span className="note-date">이메일 없이 링크만 보내면 돼요</span></div>
      <div className="invite-form">
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="링크 역할">
          <option value="editor">편집자로 초대</option>
          <option value="viewer">열람자로 초대</option>
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="유효 기간">
          {LINK_DAYS.map((d) => <option key={d} value={d}>{d}일 동안 유효</option>)}
        </select>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          let url = null;
          const op = createInviteLink(db, user, cal, role, days).then((r) => { url = r.url; });
          const r = await write(op, '초대 링크를 만들었습니다.');
          setBusy(false);
          if (r === 'ok' && url) shareLink(url, cal.name, toast);
        }}>{busy ? '만드는 중…' : '링크 만들고 보내기'}</button>
      </div>
      <p className="hint">링크를 받은 사람은 눌러서 Google 계정으로 로그인하면 바로 참여합니다. 링크를 가진 누구나 들어올 수 있으니 필요한 사람에게만 보내고, 다 쓰면 취소하세요.</p>
      {active.length > 0 && (
        <ul className="invite-list">
          {active.map((l) => (
            <li key={l.id}>
              <span className="member-main">
                <b>🔗 {ROLE_LABELS[l.role]} 링크</b>
                <span className="muted small">{l.expiresAt.toDate().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}까지 유효</span>
              </span>
              <button className="btn btn-small" onClick={() => shareLink(inviteUrl(cal.id, l.id), cal.name, toast)}>보내기</button>
              <button className="btn btn-small btn-danger" onClick={async () => {
                const ok = await confirm({ title: '링크 취소', message: '이 링크로는 더 이상 참여할 수 없게 됩니다. 이미 참여한 사람은 그대로입니다.', okLabel: '취소하기', danger: true });
                if (ok) write(deleteInviteLink(db, cal.id, l.id), '링크를 취소했습니다.');
              }}>취소</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitesTab({ cal, user }) {
  const { write } = useUi();
  const [invites, setInvites] = useState(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const owner = roleOf(cal, user.uid) === 'owner';
  useEffect(() => {
    if (!owner) return undefined;
    return listenCalendarInvitations(db, cal.id, setInvites, (e) => setError(friendlyError(e)));
  }, [cal.id, owner]);
  if (!owner) return <p className="hint">초대는 소유자만 할 수 있습니다.</p>;
  if (!cal.shared) return <p className="hint">개인 캘린더입니다. "정보" 탭에서 공유 캘린더로 바꾸면 다른 사람을 초대할 수 있습니다.</p>;
  return (
    <div>
      <InviteLinkSection cal={cal} user={user} />
      <div className="note-head" style={{ marginTop: 22 }}><h2>이메일로 초대</h2><span className="note-date">특정 Google 계정만</span></div>
      <form className="invite-form" style={{ marginTop: 10 }} onSubmit={async (e) => {
        e.preventDefault();
        const op = inviteMember(db, user, cal, email, role);
        if (await write(op, `${email.trim()}님을 초대했습니다.`) !== 'error') setEmail('');
      }}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="상대방 Google 계정 이메일" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="역할">
          <option value="editor">편집자</option>
          <option value="viewer">열람자</option>
        </select>
        <button className="btn btn-primary">초대</button>
      </form>
      <p className="hint">초대받은 사람이 같은 이메일의 Google 계정으로 로그인해 수락해야 캘린더에 접근할 수 있습니다. 이메일은 자동으로 발송되지 않으니 앱 주소를 직접 알려 주세요.</p>
      {error && <p className="form-error">{error}</p>}
      {invites === null ? <p className="muted">불러오는 중…</p> : invites.length === 0 ? <p className="muted">보낸 초대가 없습니다.</p> : (
        <ul className="invite-list">
          {invites.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1)).map((i) => (
            <li key={i.id}>
              <span className="member-main"><b>{i.email}</b><span className="muted small">{ROLE_LABELS[i.role]}</span></span>
              <span className={`status status-${i.status}`}>{INVITE_STATUS_LABELS[i.status]}</span>
              {i.status === 'pending'
                ? <button className="btn btn-small" onClick={() => write(cancelInvitation(db, user, cal.id, i.email), '초대를 취소했습니다.')}>취소</button>
                : <button className="btn btn-small" onClick={() => write(deleteInvitation(db, cal.id, i.email), '기록을 삭제했습니다.')}>기록 삭제</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubscriptionsTab({ cal, user, calendars, subscriptions }) {
  const { write } = useUi();
  const mine = subscriptions.filter((s) => s.targetCalendarId === cal.id);
  const subscribed = new Set(mine.map((s) => s.sourceCalendarId));
  const options = calendars.filter((c) => c.id !== cal.id && !subscribed.has(c.id));
  const [source, setSource] = useState('');
  const nameOf = (id) => calendars.find((c) => c.id === id)?.name;
  return (
    <div>
      <p className="hint">다른 캘린더의 일정을 이 캘린더 화면에서 함께 봅니다. 일정은 복사되지 않으며 원본이 바뀌면 바로 반영됩니다. 구독은 나에게만 보이고, 원본 캘린더 권한이 그대로 적용됩니다.</p>
      <form className="invite-form" onSubmit={async (e) => {
        e.preventDefault();
        if (!source) return;
        if (await write(subscribe(db, user, cal.id, source, calendars), `${nameOf(source)} 캘린더를 구독했습니다.`) !== 'error') setSource('');
      }}>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="구독할 캘린더">
          <option value="">구독할 캘린더 선택</option>
          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!source}>구독</button>
      </form>
      {options.length === 0 && <p className="muted small">구독할 수 있는 다른 캘린더가 없습니다.</p>}
      <ul className="invite-list">
        {mine.map((s) => {
          const st = subscriptionStatus(s, calendars);
          const src = calendars.find((c) => c.id === s.sourceCalendarId);
          return (
            <li key={s.id}>
              <span className="dot" style={{ background: src?.color || '#999' }} />
              <span className="member-main"><b>{src?.name || '(접근할 수 없는 캘린더)'}</b>
                <span className="muted small">{st === 'no-access' ? '원본 접근 권한이 없어 표시가 중단되었습니다' : st === 'paused' ? '일시 중지됨' : `내 역할: ${ROLE_LABELS[roleOf(src, user.uid)]}`}</span>
              </span>
              {st !== 'no-access' && (
                <button className="btn btn-small" onClick={() => write(setSubscriptionActive(db, s.id, !s.active), s.active ? '구독을 일시 중지했습니다.' : '구독을 다시 표시합니다.')}>
                  {s.active ? '일시 중지' : '다시 표시'}
                </button>
              )}
              <button className="btn btn-small btn-danger" onClick={() => write(unsubscribe(db, s.id), '구독을 해제했습니다. 원본 일정은 그대로입니다.')}>구독 해제</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CalendarSettingsDialog({ cal, user, calendars, subscriptions, initialTab = 'info', onClose }) {
  const [tab, setTab] = useState(initialTab);
  if (!cal) {
    return <Modal title="캘린더" onClose={onClose} small><p>이 캘린더에 더 이상 접근할 수 없습니다.</p></Modal>;
  }
  const tabs = [['info', '정보'], ['members', `멤버 ${cal.memberIds.length}`], ['invites', '초대'], ['subs', '구독']];
  return (
    <Modal title={cal.name} onClose={onClose} wide>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'info' && <InfoTab cal={cal} user={user} onClose={onClose} />}
      {tab === 'members' && <MembersTab cal={cal} user={user} />}
      {tab === 'invites' && <InvitesTab cal={cal} user={user} />}
      {tab === 'subs' && <SubscriptionsTab cal={cal} user={user} calendars={calendars} subscriptions={subscriptions} />}
    </Modal>
  );
}

export function InvitationsDialog({ user, invitations, error, onClose }) {
  const { write } = useUi();
  return (
    <Modal title="받은 초대" onClose={onClose}>
      {error && <p className="form-error">{error}</p>}
      {invitations.length === 0 ? <p className="muted">대기 중인 초대가 없습니다.</p> : (
        <ul className="invite-list">
          {invitations.map((i) => (
            <li key={`${i.calendarId}/${i.id}`}>
              <span className="dot" style={{ background: i.calendarColor }} />
              <span className="member-main"><b>{i.calendarName}</b><span className="muted small">{i.invitedByName}님이 {ROLE_LABELS[i.role]}로 초대</span></span>
              <button className="btn btn-small btn-primary" onClick={() => write(acceptInvitation(db, user, i), `${i.calendarName}에 참여했습니다.`)}>수락</button>
              <button className="btn btn-small" onClick={() => write(declineInvitation(db, user, i), '초대를 거절했습니다.')}>거절</button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">초대는 로그인한 Google 계정 이메일({user.email})로 온 것만 표시됩니다.</p>
    </Modal>
  );
}
