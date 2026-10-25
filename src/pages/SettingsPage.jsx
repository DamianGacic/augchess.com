import { useCallback, useEffect, useState } from 'react';
import { useStore, setState } from '../store.js';

// A heartbeat lands every 10 minutes while the tab is visible (auth.js).
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

const BOARD_THEMES = [['brown', 'Brown'], ['green', 'Green'], ['blue', 'Blue'], ['gray', 'Gray']];
const TOGGLES = [
  ['coords', 'Show coordinates'],
  ['legalMoves', 'Show legal moves'],
  ['lastMove', 'Highlight last move'],
  ['animations', 'Piece animations'],
  ['autoQueen', 'Always promote to Queen'],
];

function AccountSection({ session, profile }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  if (!session) {
    return (
      <div>
        <p className="settings-note lead">Not signed in. An account is optional; it gives you a display name and friends.</p>
        <button className="btn btn-primary settings-inline-btn" onClick={() => setState({ authOpen: true })}>Sign in</button>
      </div>
    );
  }

  async function save() {
    setSaving(true);
    setStatus('Saving…');
    const { error } = await Auth.setDisplayName(name.trim());
    setSaving(false);
    setStatus(error ? (error.message || 'Could not save — try another name.') : 'Saved!');
    if (!error) setEditing(false);
  }

  return (
    <div>
      <div className="settings-row">
        <span className="settings-label">Email</span>
        <span className="settings-value">{session.user.email}</span>
      </div>
      <div className="settings-row">
        <span className="settings-label">Display name</span>
        <span className="settings-value">
          <span>{(profile && profile.display_name) || 'Not set'}</span>
          <button className="link-btn" onClick={() => { setName((profile && profile.display_name) || ''); setStatus(''); setEditing(!editing); }}>Edit</button>
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-label">Rating</span>
        <span className="settings-value">{(profile && profile.rating) || '—'}</span>
      </div>
      {editing && (
        <div className="settings-inline-form">
          <input type="text" className="auth-email-input" placeholder="Display name" maxLength={20} autoComplete="off" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary settings-inline-btn" disabled={saving} onClick={save}>Save</button>
        </div>
      )}
      <p className="auth-status-msg">{status}</p>
      <button className="btn btn-secondary settings-inline-btn sign-out-btn" onClick={() => Auth.signOut()}>Sign out</button>
    </div>
  );
}

function FriendRow({ friend, actions }) {
  const [busy, setBusy] = useState(false);
  const online = friend.status === 'accepted' && Date.now() - new Date(friend.last_seen_at) < ONLINE_WINDOW_MS;
  return (
    <li className="friend-row">
      <span className={'friend-name' + (online ? ' online' : '')}>{friend.display_name || '(no name)'}</span>
      {friend.direction === 'outgoing' && <span className="friend-tag">Request sent</span>}
      {actions.map(([label, fn, primary]) => (
        <button
          key={label}
          className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} friend-btn`}
          disabled={busy}
          onClick={async () => { setBusy(true); await fn(); setBusy(false); }}
        >{label}</button>
      ))}
    </li>
  );
}

function FriendsSection() {
  const [friends, setFriends] = useState([]);
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');
  // Inline two-step instead of confirm(): a native dialog would block the page.
  const [removeArmed, setRemoveArmed] = useState(null);

  const refresh = useCallback(async () => {
    const { data, error } = await Auth.listFriends();
    if (error) setStatus('Could not load friends.');
    else setFriends(data);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Runs one RPC, surfaces its error, and reloads the list either way.
  const act = (rpc) => async () => {
    const { error } = await rpc();
    if (error) setStatus(error.message || 'Something went wrong — try again.');
    refresh();
  };

  async function add(e) {
    e.preventDefault();
    const target = name.trim();
    if (!target) return;
    setStatus('Sending…');
    const { error } = await Auth.sendFriendRequest(target);
    setStatus(error ? (error.message || 'Could not send request.') : `Request sent to ${target}.`);
    if (!error) setName('');
    refresh();
  }

  function remove(f) {
    if (removeArmed === f.user_id) {
      setRemoveArmed(null);
      return act(() => Auth.removeFriend(f.user_id))();
    }
    setRemoveArmed(f.user_id);
    setStatus(`Click Remove again to unfriend ${f.display_name || 'them'}.`);
  }

  const requests = friends.filter(f => f.status === 'pending');
  const accepted = friends.filter(f => f.status === 'accepted');

  return (
    <div>
      <form className="settings-inline-form" onSubmit={add}>
        <input type="text" className="auth-email-input" placeholder="Friend's display name" maxLength={20} autoComplete="off" aria-label="Friend's display name" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-primary settings-inline-btn" type="submit">Add friend</button>
      </form>
      <p className="auth-status-msg">{status}</p>
      <h3 className="settings-subhead">Requests</h3>
      <ul className="friend-list">
        {requests.map(f => (
          <FriendRow
            key={f.user_id}
            friend={f}
            actions={f.direction === 'incoming'
              ? [['Accept', act(() => Auth.respondFriendRequest(f.user_id, true)), true],
                 ['Decline', act(() => Auth.respondFriendRequest(f.user_id, false))]]
              : [['Cancel', act(() => Auth.removeFriend(f.user_id))]]}
          />
        ))}
        {!requests.length && <li className="friend-empty">No pending requests.</li>}
      </ul>
      <h3 className="settings-subhead">Friends</h3>
      <ul className="friend-list">
        {accepted.map(f => <FriendRow key={f.user_id} friend={f} actions={[['Remove', () => remove(f)]]} />)}
        {!accepted.length && <li className="friend-empty">No friends yet — add someone by their display name.</li>}
      </ul>
    </div>
  );
}

// Board preferences live in settings.js (applied to <body>, read by the game).
function BoardSection() {
  const [prefs, setPrefs] = useState(() => Object.fromEntries(Object.keys(Settings.DEFAULTS).map(k => [k, Settings.get(k)])));
  const update = (key, value) => {
    Settings.set(key, value);
    setPrefs(p => ({ ...p, [key]: value }));
  };
  return (
    <>
      <label className="settings-row">
        <span className="settings-label">Board theme</span>
        <select className="settings-select" value={prefs.boardTheme} onChange={e => update('boardTheme', e.target.value)}>
          {BOARD_THEMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {TOGGLES.map(([key, label]) => (
        <label key={key} className="settings-row">
          <span className="settings-label">{label}</span>
          <input type="checkbox" className="settings-toggle" checked={prefs[key]} onChange={e => update(key, e.target.checked)} />
        </label>
      ))}
      <p className="settings-note">Saved on this device.</p>
    </>
  );
}

export default function SettingsPage() {
  const { session, profile } = useStore();
  return (
    <main className="augments-main account-main">
      <div className="page-head">
        <h1>Settings</h1>
        <p>Your account, friends and how the board looks.</p>
      </div>
      <section className="settings-card">
        <h2>Account</h2>
        <AccountSection session={session} profile={profile} />
      </section>
      <section className="settings-card">
        <h2>Friends</h2>
        {session ? <FriendsSection key={session.user.id} /> : <p className="settings-note">Sign in to add friends.</p>}
      </section>
      <section className="settings-card">
        <h2>Board</h2>
        <BoardSection />
      </section>
    </main>
  );
}
