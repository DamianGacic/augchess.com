import { useEffect, useState } from 'react';
import { useStore, setState } from '../store.js';

const PROVIDERS = [
  ['google', 'Continue with Google', (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" /><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" /></svg>
  )],
  ['x', 'Continue with X', (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.9 2.3h7l4.8 6.4 5.5-6.4zm-1.2 17.9h1.9L7.1 4.2H5.1L17 20.2z" /></svg>
  )],
];

// Optional sign-in: Google / X, or email + password. A display name typed
// when creating an account is applied on first login (see track_login()).
export default function AuthModal() {
  const { authOpen } = useStore();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authOpen) { setEmail(''); setPassword(''); setDisplayName(''); setStatus(''); }
  }, [authOpen]);

  if (!authOpen) return null;
  const close = () => setState({ authOpen: false });
  const signingUp = mode === 'signup';

  async function oauth(provider) {
    setStatus('Redirecting…');
    const { error } = await Auth.signInWithProvider(provider);
    if (error) setStatus(error.message || 'Could not start sign-in — try again.');
  }

  async function submit(e) {
    e.preventDefault();
    const addr = email.trim();
    const name = displayName.trim();
    if (!addr || !password) return;
    setBusy(true);
    setStatus(signingUp ? 'Creating your account…' : 'Signing in…');
    if (signingUp && name) {
      const { available, error } = await Auth.checkDisplayNameAvailable(name);
      if (!error && available === false) {
        setStatus('That display name is taken — leave it blank and pick one later, or try another.');
        setBusy(false);
        return;
      }
    }
    const { data, error } = signingUp ? await Auth.signUp(addr, password, name) : await Auth.signIn(addr, password);
    setBusy(false);
    if (error) setStatus(error.message || 'Something went wrong — try again.');
    else if (data.session) close();
    else setStatus('Check your email to confirm your account, then sign in.');
  }

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-content auth-modal-content">
        <h3>{signingUp ? 'Create account' : 'Sign in'}</h3>
        <p className="augment-subtitle">Optional — sync your profile across devices. Playing and sharing game links never requires an account.</p>
        <div className="auth-oauth">
          {PROVIDERS.map(([id, label, icon]) => (
            <button key={id} className="btn btn-secondary auth-oauth-btn" onClick={() => oauth(id)}>{icon}{label}</button>
          ))}
        </div>
        <div className="auth-divider"><span>or use email</span></div>
        <form className="auth-form" onSubmit={submit}>
          <input type="email" className="auth-email-input" placeholder="you@example.com" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" className="auth-email-input" placeholder="Password" autoComplete={signingUp ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={e => setPassword(e.target.value)} />
          {signingUp && (
            <>
              <input type="text" className="auth-email-input" placeholder="Display name (optional)" maxLength={20} autoComplete="off" value={displayName} onChange={e => setDisplayName(e.target.value)} />
              <p className="auth-hint">You can leave this blank and choose or change it anytime in Settings.</p>
            </>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>{signingUp ? 'Create account' : 'Sign in'}</button>
        </form>
        <button type="button" className="link-btn" onClick={() => { setMode(signingUp ? 'signin' : 'signup'); setStatus(''); }}>
          {signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        <p className="auth-status-msg">{status}</p>
        <button className="btn btn-secondary" onClick={close}>Close</button>
      </div>
    </div>
  );
}
