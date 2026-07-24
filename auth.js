/**
 * auth.js — Optional Supabase-backed login (magic link) plus rough usage
 * logging. Talks directly from the browser to Supabase — server/index.js
 * and the game protocol are never involved, so hotseat play and game links
 * work identically whether or not this module ever succeeds at anything.
 * If the project isn't configured yet (supabase-config.js placeholders) or
 * the CDN script fails to load, init() no-ops and the profile button just
 * won't be able to sign anyone in — nothing else breaks.
 *
 * Relies on (loaded before this file in index.html):
 *   the Supabase CDN script (exposes window.supabase), supabase-config.js
 */
const Auth = (function () {
  const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

  let client = null;
  let session = null;
  let heartbeatTimer = null;
  let onChangeCb = () => {};

  function configured() {
    return typeof SUPABASE_URL === 'string' && !SUPABASE_URL.includes('YOUR-PROJECT') &&
           typeof SUPABASE_ANON_KEY === 'string' && !SUPABASE_ANON_KEY.includes('YOUR-ANON');
  }

  function init() {
    if (!configured() || typeof window.supabase === 'undefined') return;
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Auth: Supabase client failed to initialize', e);
      return;
    }
    client.auth.getSession().then(({ data }) => handleSession(data.session));
    client.auth.onAuthStateChange((event, newSession) => {
      handleSession(newSession);
      if (event === 'SIGNED_IN') trackLogin();
    });
  }

  function handleSession(newSession) {
    session = newSession;
    if (session && !heartbeatTimer) startHeartbeat();
    if (!session && heartbeatTimer) stopHeartbeat();
    onChangeCb(session);
  }

  // Rough usage logging only — never gates anything the user can do, so a
  // failure here is logged and otherwise ignored.
  function trackLogin() {
    client.rpc('track_login').then(({ error }) => {
      if (error) console.warn('Auth: track_login failed', error);
    });
  }

  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      if (!session || document.visibilityState !== 'visible') return;
      client.rpc('track_heartbeat').then(({ error }) => {
        if (error) console.warn('Auth: track_heartbeat failed', error);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  async function sendMagicLink(email) {
    if (!client) return { error: new Error('Supabase is not configured') };
    return client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
  }

  async function signOut() {
    if (client) await client.auth.signOut();
  }

  return {
    init,
    sendMagicLink,
    signOut,
    get session() { return session; },
    // Fires immediately on init (with the restored session, or null) and
    // again on every sign-in/sign-out.
    onChange(cb) { onChangeCb = cb; },
  };
})();

// ─── Profile button / modal wiring ─────────────────────────────────────────
function initAuthUI() {
  const profileBtn   = document.getElementById('profile-btn');
  const profileMenu  = document.getElementById('profile-menu');
  const profileEmail = document.getElementById('profile-email');
  const signOutBtn   = document.getElementById('sign-out-btn');

  const authModal  = document.getElementById('auth-modal');
  const emailInput = document.getElementById('auth-email-input');
  const sendLinkBtn= document.getElementById('auth-send-link-btn');
  const closeBtn   = document.getElementById('auth-close-btn');
  const statusMsg  = document.getElementById('auth-status-msg');

  Auth.onChange((session) => {
    profileMenu.classList.add('hidden');
    profileBtn.classList.toggle('signed-in', !!session);
    if (session) profileEmail.textContent = session.user.email;
  });
  Auth.init();

  profileBtn.addEventListener('click', () => {
    if (Auth.session) {
      profileMenu.classList.toggle('hidden');
    } else {
      statusMsg.textContent = '';
      emailInput.value = '';
      authModal.classList.remove('hidden');
    }
  });

  signOutBtn.addEventListener('click', async () => {
    profileMenu.classList.add('hidden');
    await Auth.signOut();
  });

  sendLinkBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return;
    sendLinkBtn.disabled = true;
    statusMsg.textContent = 'Sending…';
    const { error } = await Auth.sendMagicLink(email);
    sendLinkBtn.disabled = false;
    statusMsg.textContent = error
      ? 'Something went wrong — try again.'
      : 'Check your email for a sign-in link.';
  });

  closeBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) authModal.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!profileMenu.classList.contains('hidden') &&
        !profileMenu.contains(e.target) && e.target !== profileBtn) {
      profileMenu.classList.add('hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', initAuthUI);
