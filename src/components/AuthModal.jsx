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
// Also the password reset: 'forgot' emails a reset link, and 'reset' (opened
// by main.jsx when the page comes back from that link) sets the new password.
const TITLES = { signin: 'Sign in', signup: 'Create account', forgot: 'Reset your password', reset: 'Choose a new password' };

export default function AuthModal() {
  const { authOpen, authMode } = useStore();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'forgot' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (authOpen) {
      setMode(authMode || 'signin');
      setEmail(''); setPassword(''); setConfirm(''); setDisplayName(''); setStatus(''); setDone(false);
    }
  }, [authOpen, authMode]);

  if (!authOpen) return null;
  const close = () => setState({ authOpen: false, authMode: 'signin' });
  const switchTo = (next) => { setMode(next); setPassword(''); setConfirm(''); setStatus(''); setDone(false); };
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
    // Supabase answers a sign-up for an already-registered email with a
    // user that has no identities, and sends nothing.
    else if (data.user && data.user.identities && !data.user.identities.length) {
      setStatus('That email already has an account. Sign in instead, or reset your password if you never set one.');
    }
    else setStatus('Check your email to confirm your account, then sign in.');
  }

  async function sendReset(e) {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    setStatus('Sending…');
    const { error } = await Auth.requestPasswordReset(addr);
    setBusy(false);
    if (error) { setStatus(error.message || 'Could not send the reset email — try again.'); return; }
    setDone(true);
    setStatus(`If ${addr} has an account, a reset link is on its way. Open it on this device to choose a new password.`);
  }

  async function savePassword(e) {
    e.preventDefault();
    if (password.length < 6) { setStatus('Use at least 6 characters.'); return; }
    if (password !== confirm) { setStatus('The passwords don\'t match.'); return; }
    setBusy(true);
    setStatus('Saving…');
    const { error } = await Auth.updatePassword(password);
    setBusy(false);
    if (error) { setStatus(error.message || 'Could not save the password — the reset link may have expired. Request a new one.'); return; }
    setDone(true);
    setStatus('Password updated. You\'re signed in.');
  }

  let body;
  if (mode === 'forgot') {
    body = (<>
      <p className="augment-subtitle">Enter your email and we'll send you a link to choose a new password. This also works if you signed up with Google or X and never set one.</p>
      <form className="auth-form" onSubmit={sendReset}>
        <input type="email" className="auth-email-input" placeholder="you@example.com" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || done}>Send reset link</button>
      </form>
      <button type="button" className="link-btn" onClick={() => switchTo('signin')}>Back to sign in</button>
    </>);
  } else if (mode === 'reset') {
    body = done ? null : (<>
      <p className="augment-subtitle">You opened a password reset link. Pick a new password for your account.</p>
      <form className="auth-form" onSubmit={savePassword}>
        <input type="password" className="auth-email-input" placeholder="New password" autoComplete="new-password" minLength={6} required value={password} onChange={e => setPassword(e.target.value)} />
        <input type="password" className="auth-email-input" placeholder="Repeat new password" autoComplete="new-password" minLength={6} required value={confirm} onChange={e => setConfirm(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy}>Save password</button>
      </form>
    </>);
  } else {
    body = (<>
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
      {!signingUp && <button type="button" className="link-btn" onClick={() => switchTo('forgot')}>Forgot password?</button>}
      <button type="button" className="link-btn" onClick={() => switchTo(signingUp ? 'signin' : 'signup')}>
        {signingUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </>);
  }

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-content auth-modal-content">
        <h3>{TITLES[mode]}</h3>
        {body}
        <p className="auth-status-msg">{status}</p>
        <button className="btn btn-secondary" onClick={close}>{mode === 'reset' && done ? 'Done' : 'Close'}</button>
      </div>
    </div>
  );
}
