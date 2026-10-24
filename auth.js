/**
 * auth.js — Optional Supabase-backed login (magic link) plus rough usage
 * logging. Talks directly from the browser to Supabase — server/index.js
 * and the game protocol are never involved, so hotseat play and game links
 * work identically whether or not this module ever succeeds at anything.
 * If the project isn't configured yet (supabase-config.js placeholders) or
 * the CDN script fails to load, init() no-ops and the profile button just
 * won't be able to sign anyone in — nothing else breaks.
 *
 * Display names are optional and unique (enforced by a case-insensitive
 * unique index in Postgres — see supabase/schema.sql). A name typed in at
 * signup rides along as auth user_metadata and is applied by the
 * track_login() RPC on first login only if it's still free; it can also be
 * set/changed anytime afterward from the Settings page via set_display_name().
 * Friends (request/accept/remove by display name) are thin RPC wrappers here;
 * the UI for them lives in settings.js.
 *
 * Relies on (loaded before this file in index.html):
 *   the Supabase CDN script (exposes window.supabase), supabase-config.js
 */
const Auth = (function () {
  const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

  let client = null;
  let session = null;
  let profile = null;
  let heartbeatTimer = null;
  let onChangeCb = () => {};
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });

  function configured() {
    return typeof SUPABASE_URL === 'string' && !SUPABASE_URL.includes('YOUR-PROJECT') &&
           typeof SUPABASE_ANON_KEY === 'string' && !SUPABASE_ANON_KEY.includes('YOUR-ANON');
  }

  // Resolves ready once the restored session (or lack of one) is known.
  function init() {
    return initClient().finally(markReady);
  }

  async function initClient() {
    if (!configured() || typeof window.supabase === 'undefined') return;
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn('Auth: Supabase client failed to initialize', e);
      return;
    }
    const { data } = await client.auth.getSession();
    await handleSession(data.session);
    client.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_IN') await trackLogin();
      await handleSession(newSession);
    });
  }

  async function handleSession(newSession) {
    session = newSession;
    if (session && !heartbeatTimer) startHeartbeat();
    if (!session && heartbeatTimer) stopHeartbeat();
    profile = session ? await fetchProfile() : null;
    onChangeCb(session, profile);
  }

  async function fetchProfile() {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    if (error) { console.warn('Auth: fetchProfile failed', error); return null; }
    return data;
  }

  // Rough usage logging only — never gates anything the user can do, so a
  // failure here is logged and otherwise ignored. Also applies a display
  // name chosen at signup time, server-side (see track_login() in
  // supabase/schema.sql) — nothing to do with that here beyond triggering it.
  async function trackLogin() {
    const { error } = await client.rpc('track_login');
    if (error) console.warn('Auth: track_login failed', error);
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

  // displayName is optional — if given, it's sent as user_metadata and
  // applied server-side only if the account is new AND the name is still
  // free by the time the magic link is clicked (see track_login()).
  async function sendMagicLink(email, displayName) {
    if (!client) return { error: new Error('Supabase is not configured') };
    const trimmed = (displayName || '').trim();
    return client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
        ...(trimmed ? { data: { display_name: trimmed } } : {}),
      },
    });
  }

  // Set/change/clear (empty string) the signed-in user's display name.
  // Rejected server-side (error.message) if already taken by someone else.
  async function setDisplayName(name) {
    if (!client) return { error: new Error('Supabase is not configured') };
    const { error } = await client.rpc('set_display_name', { new_name: name });
    if (!error) {
      profile = await fetchProfile();
      onChangeCb(session, profile);
    }
    return { error };
  }

  // Live-check availability before committing to a name, both pre-signup
  // (anonymous) and when editing later (excludes the caller's own name).
  async function checkDisplayNameAvailable(name) {
    if (!client) return { available: true, error: null };
    const { data, error } = await client.rpc('display_name_available', { check_name: name });
    return { available: data, error };
  }

  // Friends — see supabase/migrations/0003_friends.sql. Each returns
  // { data, error } straight from the RPC.
  function rpc(name, args) {
    if (!client) return Promise.resolve({ data: null, error: new Error('Supabase is not configured') });
    return client.rpc(name, args);
  }
  const listFriends = () => rpc('list_friends');
  const sendFriendRequest = (name) => rpc('send_friend_request', { friend_name: name });
  const respondFriendRequest = (userId, accept) => rpc('respond_friend_request', { other: userId, accept });
  const removeFriend = (userId) => rpc('remove_friend', { other: userId });
  const leaderboard = () => rpc('leaderboard');

  async function signOut() {
    if (client) await client.auth.signOut();
  }

  return {
    init,
    sendMagicLink,
    signOut,
    setDisplayName,
    checkDisplayNameAvailable,
    listFriends,
    sendFriendRequest,
    respondFriendRequest,
    removeFriend,
    leaderboard,
    // Resolves once init() has restored the session (or found none).
    ready,
    get session() { return session; },
    get profile() { return profile; },
    // Fires immediately on init (with the restored session/profile, or
    // null/null) and again on every sign-in/sign-out/display-name change.
    onChange(cb) { onChangeCb = cb; },
  };
})();

// ─── Profile button / Settings account section / sign-in modal wiring ──────
function initAuthUI() {
  const profileBtn   = document.getElementById('profile-btn');
  const profileEmail = document.getElementById('profile-email');
  const signOutBtn   = document.getElementById('sign-out-btn');

  const nameLabel   = document.getElementById('profile-displayname-label');
  const nameEditBtn = document.getElementById('profile-displayname-edit-btn');
  const nameForm    = document.getElementById('profile-displayname-form');
  const nameEditInput = document.getElementById('profile-displayname-input');
  const nameSaveBtn = document.getElementById('profile-displayname-save-btn');
  const nameStatus  = document.getElementById('profile-displayname-status');

  const authModal   = document.getElementById('auth-modal');
  const emailInput  = document.getElementById('auth-email-input');
  const signupNameInput = document.getElementById('auth-displayname-input');
  const sendLinkBtn = document.getElementById('auth-send-link-btn');
  const closeBtn    = document.getElementById('auth-close-btn');
  const statusMsg   = document.getElementById('auth-status-msg');

  Auth.onChange((session, profile) => {
    nameForm.classList.add('hidden');
    profileBtn.classList.toggle('signed-in', !!session);
    document.getElementById('account-signed-in').classList.toggle('hidden', !session);
    document.getElementById('account-signed-out').classList.toggle('hidden', !!session);
    document.getElementById('friends-signed-in').classList.toggle('hidden', !session);
    document.getElementById('friends-signed-out').classList.toggle('hidden', !!session);
    if (session) {
      Settings.refreshFriends();
      profileEmail.textContent = session.user.email;
      nameLabel.textContent = (profile && profile.display_name) || 'Not set';
      document.getElementById('profile-rating').textContent = (profile && profile.rating) || '—';
    }
  });
  Auth.init();

  profileBtn.addEventListener('click', () => showView('account'));

  document.getElementById('account-sign-in-btn').addEventListener('click', () => {
    statusMsg.textContent = '';
    emailInput.value = '';
    signupNameInput.value = '';
    authModal.classList.remove('hidden');
  });

  signOutBtn.addEventListener('click', () => Auth.signOut());

  sendLinkBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const displayName = signupNameInput.value.trim();
    if (!email) return;
    sendLinkBtn.disabled = true;
    statusMsg.textContent = 'Sending…';
    if (displayName) {
      const { available, error: availErr } = await Auth.checkDisplayNameAvailable(displayName);
      if (!availErr && available === false) {
        statusMsg.textContent = 'That display name is taken — leave it blank and pick one later, or try another.';
        sendLinkBtn.disabled = false;
        return;
      }
    }
    const { error } = await Auth.sendMagicLink(email, displayName);
    sendLinkBtn.disabled = false;
    if (!error) statusMsg.textContent = 'Check your email for a sign-in link.';
    else if (error.code === 'over_email_send_rate_limit' || error.status === 429)
      statusMsg.textContent = 'Too many sign-in emails sent recently — wait a bit and try again.';
    else statusMsg.textContent = 'Something went wrong — try again.';
  });

  closeBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) authModal.classList.add('hidden');
  });

  nameEditBtn.addEventListener('click', () => {
    nameEditInput.value = (Auth.profile && Auth.profile.display_name) || '';
    nameStatus.textContent = '';
    nameForm.classList.toggle('hidden');
  });

  nameSaveBtn.addEventListener('click', async () => {
    const value = nameEditInput.value.trim();
    nameSaveBtn.disabled = true;
    nameStatus.textContent = 'Saving…';
    const { error } = await Auth.setDisplayName(value);
    nameSaveBtn.disabled = false;
    nameStatus.textContent = error ? (error.message || 'Could not save — try another name.') : 'Saved!';
  });
}

document.addEventListener('DOMContentLoaded', initAuthUI);
