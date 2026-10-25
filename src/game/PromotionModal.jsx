import { useGame } from '../gameBridge.js';

const CHOICES = [['q', 'Queen'], ['r', 'Rook'], ['b', 'Bishop'], ['n', 'Knight']];

// Opens while app.js's pendingPromotion is set (a pawn reached the last rank
// and auto-queen is off).
export default function PromotionModal() {
  useGame();
  if (!pendingPromotion) return null;
  const { color } = pendingPromotion;
  return (
    <div className="modal">
      <div className="modal-content">
        <h3>Promote Pawn</h3>
        <div className="promotion-pieces">
          {CHOICES.map(([p, name]) => (
            <div key={p} className={`promotion-piece ${color}`} title={name} onClick={() => choosePromotion(p)}>
              {PIECES[color + p.toUpperCase()]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
