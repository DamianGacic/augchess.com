import { useStore } from '../store.js';
import { useGame } from '../gameBridge.js';
import { AugmentEmblem } from '../components/augmentBits.jsx';

// The augment draft. All the rules (affordability, exclusivity,
// prerequisites, when the draft finishes) live in engine/draft-engine.js;
// this renders state.draftState and turns clicks into dispatch() calls.

// Which grid column an augment belongs in (first match wins).
function augmentColumn(aug) {
  if (aug.category === 'pregame') return 'Pre-game';
  if (aug.category === 'wincondition') return 'Win Condition';
  if (aug.exchanges) return 'Unit Exchange';
  if (aug.category === 'unitability') return 'Unit Abilities';
  if (aug.category === 'globalability') return 'Global Abilities';
  return 'Utility';
}

// Grid layout; pairs share one stacked column.
const COLUMNS = [['Pre-game', 'Win Condition'], ['Utility'], ['Unit Exchange'], ['Unit Abilities', 'Global Abilities']];

// Follow-up augments unlocked once `id` is owned (e.g. Ghouls unlocks
// Deviant and Breaking Rank). These never appear in the main grid — they
// only show as skill-tree children under their parent's slot card.
function augmentChildren(id) {
  return AUGMENTS.filter(a => a.requires === id);
}

const byId = id => AUGMENTS.find(a => a.id === id);

// Whether this client may act for `color` right now: anyone in hotseat,
// otherwise only for its own seat.
function canActFor(color) {
  return (!netMode && !aiColor) || myColor === color;
}

function SlotCard({ aug, className, onClick, disabled, short, title }) {
  return (
    <button type="button" className={'augment-slot-card ' + className} data-aug-id={aug.id} onClick={onClick} disabled={disabled} title={title}>
      <AugmentEmblem aug={aug} />
      <span className="as-text">
        <span className="as-name">{aug.name}</span>
        <span className="as-cost">{aug.cost} pt{aug.cost === 1 ? '' : 's'}{short > 0 && ` · ${short} short`}</span>
      </span>
    </button>
  );
}

// One player's picks: plain picks on top, then picks that unlocked a
// follow-up, each followed by that follow-up — greyed out until taken.
function SidePanel({ color, label }) {
  const ds = state.draftState;
  const owned = ds.owned[color];
  const topLevel = owned.filter(id => !augmentChildren(id).length && !byId(id).requires);
  const withChildren = owned.filter(id => augmentChildren(id).length);
  // No game-over check: a draft is never "over" (see resetToSettings in engine/index.js).
  const canPickHere = ds.current === color && canActFor(color);

  return (
    <div className="augment-side-panel">
      <div className="augment-side-label">{label}</div>
      <div className="augment-side-slots">
        {topLevel.map(id => <SlotCard key={id} aug={byId(id)} className="picked" onClick={() => showAugmentDetail(byId(id))} />)}
        {withChildren.map(id => (
          <div key={id} className="augment-slot-group">
            <SlotCard aug={byId(id)} className="picked" onClick={() => showAugmentDetail(byId(id))} />
            {augmentChildren(id).map(child => owned.includes(child.id)
              ? <SlotCard key={child.id} aug={child} className="picked child" onClick={() => showAugmentDetail(child)} />
              : (
                <SlotCard
                  key={child.id}
                  aug={child}
                  className={'greyed child' + (ds.points[color] < child.cost ? ' short' : '')}
                  disabled={!(canPickHere && ds.points[color] >= child.cost)}
                  short={child.cost - ds.points[color]}
                  title={ds.points[color] < child.cost ? `Not enough points: ${child.name} costs ${child.cost}, ${ds.points[color]} left` : undefined}
                  onClick={() => dispatch({ type: 'draftPick', augId: child.id })}
                />
              ))}
          </div>
        ))}
        {!topLevel.length && !withChildren.length && <div className="augment-slot-placeholder">No picks yet</div>}
      </div>
    </div>
  );
}

// locked: not in this new player's starter set (starterSet in app.js).
function DraftCard({ aug, locked }) {
  const ds = state.draftState;
  const current = ds.current;
  const other = current === 'w' ? 'b' : 'w';
  const disabled = locked || ds.points[current] < aug.cost || conflictsWithOwned(state, current, aug) ||
    ds.owned[other].includes(aug.id) || !canActFor(current);
  return (
    <button
      className={`augment-card cost-${aug.cost}` + (disabled ? ' disabled' : '') + (locked ? ' locked' : '')}
      data-aug-id={aug.id}
      title={locked ? `Unlocks after ${UNLOCK_GAMES} games` : undefined}
      onClick={disabled ? undefined : () => dispatch({ type: 'draftPick', augId: aug.id })}
    >
      <img className="emblem" src={augmentIconUrl(aug.id)} alt="" draggable={false} />
      <div className="ac-cost">{locked ? '🔒' : aug.cost}</div>
      <div className="ac-body">
        <div className="ac-name">
          {aug.name}{' '}
          {ds.owned.w.includes(aug.id) && <span className="ac-owner white">W</span>}
          {ds.owned.b.includes(aug.id) && <span className="ac-owner black">B</span>}
        </div>
        <div className="ac-desc">{aug.desc}</div>
      </div>
    </button>
  );
}

export default function DraftModal() {
  useGame();
  const { view } = useStore();
  if (view !== 'game' || state.phase !== 'draft' || !state.draftState) return null;

  const ds = state.draftState;
  // Extension augments only show under their parent; the current player's
  // own picks move to their side panel instead of lingering in the grid.
  const grid = [...AUGMENTS].sort((a, b) => a.cost - b.cost)
    .filter(a => !a.requires && !ds.owned[ds.current].includes(a.id));
  // Starter limits only apply to picks this player makes.
  const starter = canActFor(ds.current) ? starterSet() : null;

  return (
    <div className="modal">
      <div className="modal-content augment-content">
        <h3>Augment Draft</h3>
        <p className="augment-subtitle">{ds.current === 'w' ? 'White' : 'Black'}, choose an augment (or pass)</p>
        {starter && (
          <p className="augment-unlock-note">
            New player: {STARTER_AUGMENTS} starter augments. Everything unlocks after {UNLOCK_GAMES} games ({gamesPlayed}/{UNLOCK_GAMES}).
          </p>
        )}
        <div className="augment-points-row">
          {[['w', 'White'], ['b', 'Black']].map(([c, label]) => (
            <div key={c} className={'augment-points' + (ds.current === c ? ' active' : '')}>
              <span className="ap-label">{label}</span>
              <span className="ap-value">{ds.points[c]}</span>
            </div>
          ))}
        </div>
        <div className="augment-draft-layout">
          <SidePanel color="w" label="White's Picks" />
          <div className="augment-list">
            {COLUMNS.map((stack, i) => {
              const cols = stack.map(label => (
                <div key={label} className="augment-col">
                  <div className="augment-col-label">{label}</div>
                  {grid.filter(a => augmentColumn(a) === label).map(aug => <DraftCard key={aug.id} aug={aug} locked={!!starter && !starter.has(aug.id)} />)}
                </div>
              ));
              return stack.length > 1 ? <div key={i} className="augment-col augment-col-stack">{cols}</div> : cols[0];
            })}
          </div>
          <SidePanel color="b" label="Black's Picks" />
        </div>
        <div className="augment-actions">
          <button className="btn btn-secondary" disabled={!canActFor(ds.current)} onClick={() => dispatch({ type: 'draftPass' })}>Pass / Done</button>
        </div>
      </div>
    </div>
  );
}
