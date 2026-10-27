/**
 * auth.js — Optional Supabase-backed login (email + password, Google, X) plus rough usage
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
 * Friends (request/accept/remove by display name) are thin RPC wrappers here.
 * All of the UI (profile button, sign-in modal, Settings page) is React —
 * src/ calls Auth.init() and subscribes with Auth.onChange.
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

  // New account with email + password. If the project requires email
  // confirmation the result has no session yet: the user confirms, then signs in.
  // displayName is optional — if given, it's sent as user_metadata and
  // applied server-side only if the name is still free by the time they
  // first sign in (see track_login()).
  async function signUp(email, password, displayName) {
    if (!client) return { error: new Error('Supabase is not configured') };
    const trimmed = (displayName || '').trim();
    return client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        ...(trimmed ? { data: { display_name: trimmed } } : {}),
      },
    });
  }

  async function signIn(email, password) {
    if (!client) return { error: new Error('Supabase is not configured') };
    return client.auth.signInWithPassword({ email, password });
  }

  // 'google' | 'x' — leaves the page for the provider, which sends the
  // user back here signed in (onAuthStateChange then fires SIGNED_IN).
  // Each provider must be enabled in the Supabase dashboard first.
  async function signInWithProvider(provider) {
    if (!client) return { error: new Error('Supabase is not configured') };
    return client.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
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
  // Game history — see supabase/migrations/0007_game_history.sql.
  const listGames = () => rpc('list_games');
  const gameReplay = (id) => rpc('game_replay', { game_id: id });
  // Local games (vs AI / hotseat) — the browser posts these itself.
  const recordLocalGame = (game) => rpc('record_local_game', { g: game });
  // Finished games on this account, for unlocks (0009_games_count.sql).
  const myGamesCount = () => rpc('my_games_count');

  async function signOut() {
    if (client) await client.auth.signOut();
  }

  return {
    init,
    signUp,
    signIn,
    signInWithProvider,
    signOut,
    setDisplayName,
    checkDisplayNameAvailable,
    listFriends,
    sendFriendRequest,
    respondFriendRequest,
    removeFriend,
    leaderboard,
    listGames,
    gameReplay,
    recordLocalGame,
    myGamesCount,
    // Resolves once init() has restored the session (or found none).
    ready,
    get session() { return session; },
    get profile() { return profile; },
    // Fires immediately on init (with the restored session/profile, or
    // null/null) and again on every sign-in/sign-out/display-name change.
    onChange(cb) { onChangeCb = cb; },
  };
})();
