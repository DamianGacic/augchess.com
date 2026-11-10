import { useCallback, useEffect, useState } from 'react';
import { useStore, setState } from '../store.js';

// Correspondence games: slow, turn-based games between two signed-in
// players (supabase/migrations/0011_correspondence.sql). Start one against a
// friend or as an invite link, answer invitations, and open your games —
// opening one hands off to openCorrespondenceGame in app.js, which plays it
// on the normal game screen.
const DAYS = [1, 2, 3];
const POINT_PRESETS = [4, 9, 14];
const COLORS = [['random', 'Random'], ['w', 'White'], ['b', 'Black']];
const REFRESH_MS = 10 * 1000;
const WATCH_MS = 3 * 1000; // a just-sent invitation, until it's accepted
const colorName = c => (c === 'w' ? 'White' : 'Black');
const other = c => (c === 'w' ? 'b' : 'w');

// Each side's bank right now: the running side's has been ticking since
// turn_started_at.
function bankLeft(g, color) {
  const saved = color === 'w' ? g.white_ms_left : g.black_ms_left;
  if (saved == null) return g.days * 86400000;
  if (g.turn !== color || !g.turn_started_at) return saved;
  return Math.max(0, saved - (Date.now() - new Date(g.turn_started_at)));
}

const inviteUrl = id => buildCorrespondenceUrl(id);

function CopyLink({ id }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(inviteUrl(id)); setCopied(true); } catch (e) { setCopied(false); }
  }
  return (
    <div className="settings-inline-form corr-link">
      <input type="text" className="auth-email-input" readOnly value={inviteUrl(id)} aria-label="Invite link" onFocus={e => e.target.select()} />
      <button type="button" className="btn btn-secondary settings-inline-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function Choice({ options, value, onChange, format = v => v }) {
  return (
    <div className="time-control-options">
      {options.map(o => {
        const [v, label] = Array.isArray(o) ? o : [o, format(o)];
        return <button key={v} type="button" className={'tc-btn' + (v === value ? ' selected' : '')} onClick={() => onChange(v)}>{label}</button>;
      })}
    </div>
  );
}

function NewGameForm({ onCreated }) {
  const [friends, setFriends] = useState([]);
  const [opponent, setOpponent] = useState('');
  const [days, setDays] = useState(2);
  const [points, setPoints] = useState(9);
  const [playAs, setPlayAs] = useState('random');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkId, setLinkId] = useState(null);
  const [watchId, setWatchId] = useState(null);

  useEffect(() => {
    Auth.listFriends().then(({ data }) => setFriends((data || []).filter(f => f.status === 'accepted')));
  }, []);

  // Stay on the invitation just sent: the moment it's accepted, open the
  // game (the draft is waiting on whoever plays White).
  useEffect(() => {
    if (!watchId) return undefined;
    const timer = setInterval(async () => {
      const { data } = await Auth.correspondenceGameInfo(watchId);
      const row = data && data[0];
      if (!row) return;
      if (row.status === 'active') { clearInterval(timer); openCorrespondenceGame(watchId); }
      else if (row.status !== 'invited') { clearInterval(timer); setWatchId(null); setLinkId(null); setStatus('The invitation was declined.'); onCreated(); }
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [watchId, onCreated]);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setStatus('');
    const { data, error } = await Auth.createCorrespondenceGame(opponent || null, days, points, playAs);
    setBusy(false);
    if (error) { setStatus(error.message || 'Could not start the game.'); return; }
    setWatchId(data);
    if (opponent) {
      const friend = friends.find(f => f.user_id === opponent);
      setStatus(`Challenge sent to ${friend ? friend.display_name : 'your friend'}. Keep this page open and the game opens when they accept, or find it under My Games later.`);
      setLinkId(null);
    } else {
      setStatus('Send this link to your opponent. Keep this page open and the game opens when they accept, or find it under My Games later.');
      setLinkId(data);
    }
    onCreated();
  }

  return (
    <form onSubmit={create}>
      <div className="settings-body">
        <div className="time-control">
          <div className="time-control-label">Opponent</div>
          <select className="settings-select corr-select" value={opponent} onChange={e => setOpponent(e.target.value)}>
            <option value="">Anyone with an invite link</option>
            {friends.map(f => <option key={f.user_id} value={f.user_id}>{f.display_name}</option>)}
          </select>
        </div>
        <div className="time-control">
          <div className="time-control-label">Time Bank (each)</div>
          <Choice options={DAYS} value={days} onChange={setDays} format={d => `${d} day${d > 1 ? 's' : ''}`} />
        </div>
        <div className="time-control">
          <div className="time-control-label">Auction Points</div>
          <Choice options={POINT_PRESETS} value={points} onChange={setPoints} format={p => `${p} pts`} />
        </div>
        <div className="time-control">
          <div className="time-control-label">You Play</div>
          <Choice options={COLORS} value={playAs} onChange={setPlayAs} />
        </div>
      </div>
      <p className="settings-note lead">Your bank only runs while it's your turn: draft picks, setup and moves. Run out and you lose on time.</p>
      <button className="btn btn-primary settings-inline-btn" type="submit" disabled={busy}>{busy ? 'Starting…' : opponent ? 'Send Challenge' : 'Create Invite Link'}</button>
      {status && <p className="auth-status-msg">{status}</p>}
      {linkId && <CopyLink id={linkId} />}
    </form>
  );
}

// The invitation behind a ?corr=<id> link, until it's accepted.
function InviteCard({ id, onDone }) {
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Auth.correspondenceGameInfo(id).then(({ data, error }) => {
      const row = data && data[0];
      if (error || !row) { setStatus('That correspondence game doesn\'t exist.'); return; }
      // Already yours and under way (or over): straight to the board.
      if (row.i_play && (row.status === 'active' || row.status === 'finished')) { setState({ corrInvite: null }); openCorrespondenceGame(id); return; }
      setInfo(row);
    });
  }, [id]);

  async function answer(accept) {
    setBusy(true);
    const { error } = accept ? await Auth.acceptCorrespondenceGame(id) : await Auth.cancelCorrespondenceGame(id);
    setBusy(false);
    if (error) { setStatus(error.message || 'Something went wrong. Try again.'); return; }
    if (accept) { setState({ corrInvite: null }); openCorrespondenceGame(id); } else onDone();
  }

  if (!info) return status ? <section className="settings-card"><p className="settings-note lead">{status}</p></section> : null;

  let body;
  if (info.status !== 'invited') {
    body = <p className="settings-note lead">This invitation is no longer open.</p>;
  } else if (info.i_play && !info.invited_me) {
    body = (<>
      <p className="settings-note lead">Your invitation. Waiting for someone to accept it.</p>
      {info.open_seat && <CopyLink id={id} />}
    </>);
  } else if (info.invited_me || info.open_seat) {
    body = (<>
      <p className="settings-note lead">
        <strong>{info.creator_name}</strong> challenges you to a correspondence game: {info.days} day{info.days > 1 ? 's' : ''} each, {info.points} auction points.
        You would play {colorName(other(info.creator_color))}.
      </p>
      <div className="corr-actions">
        <button className="btn btn-primary settings-inline-btn" disabled={busy} onClick={() => answer(true)}>Accept</button>
        {info.invited_me && <button className="btn btn-secondary settings-inline-btn" disabled={busy} onClick={() => answer(false)}>Decline</button>}
      </div>
    </>);
  } else {
    body = <p className="settings-note lead">This invitation is for someone else.</p>;
  }
  return (
    <section className="settings-card">
      <h2>Invitation</h2>
      {body}
      {status && <p className="auth-status-msg">{status}</p>}
    </section>
  );
}

function GameRow({ g, onChanged }) {
  const [busy, setBusy] = useState(false);
  const me = g.my_color;
  const opponent = g.opponent_name || (g.status === 'invited' ? 'Anyone with the link' : 'Guest');
  const run = rpc => async () => { setBusy(true); await rpc(); setBusy(false); onChanged(); };

  let detail, actions = null, open = false;
  if (g.status === 'active') {
    open = true;
    detail = `${g.turn === me ? 'Your move' : 'Their move'} · You ${formatBank(bankLeft(g, me))} · Them ${formatBank(bankLeft(g, other(me)))}`;
  } else if (g.status === 'invited') {
    detail = `${g.days} day${g.days > 1 ? 's' : ''} each · ${g.points} pts · ${g.created_by_me ? 'Waiting for them to accept' : 'Invites you'}`;
    actions = g.created_by_me
      ? [['Withdraw', run(() => Auth.cancelCorrespondenceGame(g.id))]]
      : [['Accept', async () => { setBusy(true); const { error } = await Auth.acceptCorrespondenceGame(g.id); setBusy(false); if (!error) openCorrespondenceGame(g.id); else onChanged(); }, true],
         ['Decline', run(() => Auth.cancelCorrespondenceGame(g.id))]];
  } else if (g.status === 'finished') {
    open = true;
    detail = g.result_text || 'Finished';
  } else {
    detail = g.created_by_me ? 'Withdrawn or declined' : 'Declined';
  }

  return (
    <li className="friend-row corr-row">
      <button type="button" className="corr-open" disabled={!open} onClick={() => openCorrespondenceGame(g.id)}>
        <span className="lb-name">
          vs {opponent} <span className="friend-tag">as {colorName(me)}</span>
          <span className="history-detail">{detail}</span>
        </span>
        {open && <span className="lb-rating">▶</span>}
      </button>
      {actions && actions.map(([label, fn, primary]) => (
        <button key={label} className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} friend-btn`} disabled={busy} onClick={fn}>{label}</button>
      ))}
    </li>
  );
}

function GameList({ title, games, empty, onChanged }) {
  return (<>
    <h3 className="settings-subhead">{title}</h3>
    <ul className="friend-list">
      {games.map(g => <GameRow key={g.id} g={g} onChanged={onChanged} />)}
      {!games.length && <li className="friend-empty">{empty}</li>}
    </ul>
  </>);
}

export default function CorrespondencePage() {
  const { session, corrInvite } = useStore();
  const [games, setGames] = useState(null);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { data, error } = await Auth.listCorrespondenceGames();
    if (error) setError('Could not load your correspondence games.');
    else { setError(''); setGames(data); }
  }, [session]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { refresh(); setTick(t => t + 1); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const closeInvite = () => {
    setState({ corrInvite: null });
    history.replaceState(null, '', location.pathname);
    refresh();
  };

  const head = (
    <div className="page-head">
      <h1>My Games</h1>
      <p>Correspondence games: slow chess with augments. Each player gets a time bank of 1 to 3 days. Play a turn whenever you like.</p>
    </div>
  );

  if (!session) {
    return (
      <main className="augments-main account-main">
        {head}
        <section className="settings-card">
          <p className="settings-note lead">Correspondence games are between signed-in players.</p>
          <button className="btn btn-primary settings-inline-btn" onClick={() => setState({ authOpen: true })}>Sign in</button>
        </section>
      </main>
    );
  }

  const list = games || [];
  const active = list.filter(g => g.status === 'active');
  const yourMove = active.filter(g => g.turn === g.my_color);
  const theirMove = active.filter(g => g.turn !== g.my_color);
  const invites = list.filter(g => g.status === 'invited');
  const done = list.filter(g => g.status === 'finished' || g.status === 'cancelled');

  return (
    <main className="augments-main account-main">
      {head}
      {corrInvite && <InviteCard id={corrInvite} onDone={closeInvite} />}
      <section className="settings-card">
        <h2>Current Games</h2>
        {!games && !error && <p className="settings-note lead">Loading…</p>}
        {error && <p className="settings-note lead">{error}</p>}
        {games && (<>
          <GameList title="Your move" games={yourMove} empty="Nothing waiting on you." onChanged={refresh} />
          <GameList title="Their move" games={theirMove} empty="No games waiting on an opponent." onChanged={refresh} />
          <GameList title="Invitations" games={invites} empty="No open invitations." onChanged={refresh} />
          <GameList title="Recently finished" games={done} empty="No finished games in the last 30 days." onChanged={refresh} />
        </>)}
      </section>
      <section className="settings-card">
        <h2>New Game</h2>
        <NewGameForm onCreated={refresh} />
      </section>
    </main>
  );
}
