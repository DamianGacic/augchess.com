import { useState } from 'react';
import { useStore } from '../store.js';
import { useGame } from '../gameBridge.js';

const MINUTES = [3, 5, 15, 25, 45];
const POINT_PRESETS = [3, 9, 14];
const COLORS = [['w', 'White'], ['b', 'Black'], ['random', 'Random']];

// Pre-draft settings: time control and auction points (either player can
// change them online — every change goes through dispatch), plus the
// human's color against the AI. Shown on the game screen whenever the room
// is in its 'settings' phase.
export default function GameSettingsModal() {
  useGame();
  const { view } = useStore();
  const [customDraft, setCustomDraft] = useState(null); // text while typing in the custom field
  if (view !== 'game' || state.phase !== 'settings') return null;

  const { minutes, points } = state.settings;
  // Sends only the changed field (the engine keeps the other as it is).
  const update = (patch) => dispatch({ type: 'settingsUpdate', ...patch });
  const isPreset = POINT_PRESETS.includes(points);

  function typeCustom(text) {
    setCustomDraft(text);
    const value = Number(text);
    if (Number.isInteger(value) && value >= 1 && value <= 99) update({ points: value });
  }

  function start() {
    AiPlayer.assignSeats();
    dispatch({ type: 'settingsStart' });
  }

  return (
    <div className="modal">
      <div className="modal-content augment-content">
        <h3>Game Settings</h3>
        <p className="augment-subtitle">Agree on a time control and auction points, then start the draft. Either player can choose.</p>
        <div className="settings-body">
          <div className="time-control">
            <div className="time-control-label">Time Control</div>
            <div className="time-control-options">
              {MINUTES.map(m => (
                <button key={m} className={'tc-btn' + (m === minutes ? ' selected' : '')} onClick={() => update({ minutes: m })}>{m} min</button>
              ))}
            </div>
          </div>
          <div className="time-control">
            <div className="time-control-label">Auction Points</div>
            <div className="time-control-options">
              {POINT_PRESETS.map(p => (
                <button key={p} className={'tc-btn' + (p === points ? ' selected' : '')} onClick={() => { setCustomDraft(null); update({ points: p }); }}>{p} pts</button>
              ))}
              {/* A non-preset value (typed here, or by the other player online)
                  lives in the custom field. */}
              <input
                type="number"
                className={'tc-custom' + (isPreset ? '' : ' selected')}
                min="1" max="99" step="1" placeholder="Custom" aria-label="Custom auction points"
                value={customDraft ?? (isPreset ? '' : points)}
                onChange={e => typeCustom(e.target.value)}
                onBlur={() => setCustomDraft(null)}
              />
            </div>
          </div>
          {AiPlayer.vsAi && (
            <div className="time-control">
              <div className="time-control-label">You Play</div>
              <div className="time-control-options">
                {COLORS.map(([c, label]) => (
                  <button key={c} className={'tc-btn' + (AiPlayer.colorChoice === c ? ' selected' : '')} onClick={() => AiPlayer.setColorChoice(c)}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="augment-actions">
          <button className="btn btn-primary" onClick={start}>Start Draft</button>
        </div>
      </div>
    </div>
  );
}
