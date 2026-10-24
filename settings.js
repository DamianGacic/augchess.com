/**
 * settings.js — The Settings page behind the profile button: board
 * preferences (saved per device in localStorage) and the friends list
 * (Supabase, via Auth — see supabase/migrations/0003_friends.sql). The
 * Account section's display-name/sign-out wiring stays in auth.js.
 *
 * Preferences are applied as classes/attributes on <body> so the board CSS
 * picks them up with no renderBoard changes; the two that need JS read
 * Settings.get(): 'animations' (board-anim.js) and 'autoQueen' (app.js).
 *
 * Depends on: auth.js (Auth) at runtime only.
 */
const Settings = (() => {
  const STORAGE_KEY = 'augchess:prefs';
  const DEFAULTS = { boardTheme: 'brown', coords: true, legalMoves: true, lastMove: true, animations: true, autoQueen: false };
  // A heartbeat lands every 10 minutes while the tab is visible (auth.js).
  const ONLINE_WINDOW_MS = 15 * 60 * 1000;

  let prefs = { ...DEFAULTS };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) { /* storage unavailable */ }

  function apply() {
    const b = document.body;
    b.dataset.boardTheme = prefs.boardTheme;
    b.classList.toggle('hide-coords', !prefs.coords);
    b.classList.toggle('hide-legal-moves', !prefs.legalMoves);
    b.classList.toggle('hide-last-move', !prefs.lastMove);
  }

  function set(key, value) {
    prefs[key] = value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ }
    apply();
  }

  function initPrefs() {
    apply();
    Object.keys(DEFAULTS).forEach(key => {
      const el = document.getElementById(`pref-${key}`);
      if (el.type === 'checkbox') {
        el.checked = prefs[key];
        el.addEventListener('change', () => set(key, el.checked));
      } else {
        el.value = prefs[key];
        el.addEventListener('change', () => set(key, el.value));
      }
    });
  }

  // ─── Friends ───────────────────────────────────────────────────────────────
  const requestsEl = () => document.getElementById('friend-requests');
  const listEl = () => document.getElementById('friend-list');
  const statusEl = () => document.getElementById('friend-status');

  function friendRow(f, actions) {
    const li = document.createElement('li');
    li.className = 'friend-row';
    const name = document.createElement('span');
    name.className = 'friend-name';
    const online = f.status === 'accepted' && Date.now() - new Date(f.last_seen_at) < ONLINE_WINDOW_MS;
    if (online) name.classList.add('online');
    name.textContent = f.display_name || '(no name)';
    li.appendChild(name);
    if (f.direction === 'outgoing') {
      const tag = document.createElement('span');
      tag.className = 'friend-tag';
      tag.textContent = 'Request sent';
      li.appendChild(tag);
    }
    actions.forEach(([label, fn, primary]) => {
      const btn = document.createElement('button');
      btn.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'} friend-btn`;
      btn.textContent = label;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const { error } = await fn();
        if (error) statusEl().textContent = error.message || 'Something went wrong — try again.';
        refreshFriends();
      });
      li.appendChild(btn);
    });
    return li;
  }

  function emptyRow(text) {
    const li = document.createElement('li');
    li.className = 'friend-empty';
    li.textContent = text;
    return li;
  }

  async function refreshFriends() {
    if (!Auth.session) return;
    const { data, error } = await Auth.listFriends();
    if (error) { statusEl().textContent = 'Could not load friends.'; return; }
    const requests = data.filter(f => f.status === 'pending');
    const friends = data.filter(f => f.status === 'accepted');
    requestsEl().replaceChildren(...requests.map(f => f.direction === 'incoming'
      ? friendRow(f, [['Accept', () => Auth.respondFriendRequest(f.user_id, true), true],
                      ['Decline', () => Auth.respondFriendRequest(f.user_id, false)]])
      : friendRow(f, [['Cancel', () => Auth.removeFriend(f.user_id)]])));
    if (!requests.length) requestsEl().appendChild(emptyRow('No pending requests.'));
    listEl().replaceChildren(...friends.map(f =>
      friendRow(f, [['Remove', () => confirmRemove(f)]])));
    if (!friends.length) listEl().appendChild(emptyRow('No friends yet — add someone by their display name.'));
  }

  // Inline two-step instead of confirm(): a native dialog would block the page.
  let removeArmed = null;
  function confirmRemove(f) {
    const armed = removeArmed === f.user_id;
    removeArmed = armed ? null : f.user_id;
    if (armed) return Auth.removeFriend(f.user_id);
    statusEl().textContent = `Click Remove again to unfriend ${f.display_name || 'them'}.`;
    return Promise.resolve({ error: null });
  }

  function initFriends() {
    const form = document.getElementById('friend-add-form');
    const input = document.getElementById('friend-add-input');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      statusEl().textContent = 'Sending…';
      const { error } = await Auth.sendFriendRequest(name);
      statusEl().textContent = error ? (error.message || 'Could not send request.') : `Request sent to ${name}.`;
      if (!error) input.value = '';
      refreshFriends();
    });
  }

  document.addEventListener('DOMContentLoaded', () => { initPrefs(); initFriends(); });

  return {
    get(key) { return prefs[key]; },
    refreshFriends,
  };
})();
