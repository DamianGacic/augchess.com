import { useStore, showView } from '../store.js';

const NAV = [
  ['home', 'Home'],
  ['leaderboard', 'Leaderboards'],
  ['history', 'History'],
  ['game', 'Game'],
  ['augments', 'Augments'],
  ['figures', 'Figures'],
];

export default function Header() {
  const { view, session } = useStore();
  return (
    <header>
      <div className="logo" title="Home" onClick={() => showView('home')}>
        <img className="logo-mark" src="assets/logo.svg" alt="" />
        <span className="logo-text"><span className="logo-accent">Aug</span>Chess</span>
      </div>
      <nav className="main-nav">
        {NAV.map(([id, label]) => (
          <button key={id} className={'nav-btn' + (view === id ? ' active' : '')} onClick={() => showView(id)}>{label}</button>
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
