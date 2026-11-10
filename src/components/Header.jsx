import { useEffect, useState } from 'react';
import { useStore, showView } from '../store.js';

const NAV = [
  ['home', 'Home'],
  ['correspondence', 'My Games'],
  ['leaderboard', 'Leaderboards'],
  ['history', 'History'],
  ['game', 'Game'],
  ['augments', 'Augments'],
  ['figures', 'Figures'],
];

// Correspondence games waiting on you (your move, or an invitation to
// answer), polled while signed in, for the count on the My Games tab.
const POLL_MS = 20 * 1000;
function useWaitingOnMe(session, view) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!session) { setCount(0); return undefined; }
    let live = true;
    const check = () => Auth.listCorrespondenceGames().then(({ data }) => {
      if (!live || !data) return;
      setCount(data.filter(g => (g.status === 'active' && g.turn === g.my_color) || (g.status === 'invited' && !g.created_by_me)).length);
    });
    check();
    const timer = setInterval(check, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [session, view]);
  return count;
}

export default function Header() {
  const { view, session } = useStore();
  const waiting = useWaitingOnMe(session, view);
  return (
    <header>
      <div className="logo" title="Home" onClick={() => showView('home')}>
        <img className="logo-mark" src="assets/logo.svg" alt="" />
        <span className="logo-text"><span className="logo-accent">Aug</span>Chess</span>
      </div>
      <nav className="main-nav">
        {NAV.map(([id, label]) => (
          <button key={id} className={'nav-btn' + (view === id ? ' active' : '')} onClick={() => showView(id)}>
            {label}
            {id === 'correspondence' && waiting > 0 && <span className="nav-count" title={`${waiting} waiting on you`}>{waiting}</span>}
          </button>
        ))}
      </nav>
      <div className="profile-wrap">
        <button
          className={'profile-btn' + (session ? ' signed-in' : '') + (view === 'account' ? ' active' : '')}
          title="Account"
          aria-label="Account"
          onClick={() => showView('account')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
        </button>
      </div>
      {/* Owned by app.js (updateMpBadge sets its text and classes); React only
          renders it once and never re-renders its props. */}
      <div id="mp-badge" className="mp-badge hidden" />
    </header>
  );
}
