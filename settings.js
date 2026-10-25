/**
 * settings.js — Board preferences, saved per device in localStorage. The
 * Settings page that edits them is React (src/pages/SettingsPage.jsx), via
 * Settings.get/set.
 *
 * Preferences are applied as classes/attributes on <body> so the board CSS
 * picks them up with no renderBoard changes; the two that need JS read
 * Settings.get(): 'animations' (board-anim.js) and 'autoQueen' (app.js).
 */
const Settings = (() => {
  const STORAGE_KEY = 'augchess:prefs';
  const DEFAULTS = { boardTheme: 'brown', coords: true, legalMoves: true, lastMove: true, animations: true, autoQueen: false };

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

  apply(); // classic script at the end of <body>, so document.body exists

  return {
    DEFAULTS,
    get(key) { return prefs[key]; },
    set,
  };
})();
