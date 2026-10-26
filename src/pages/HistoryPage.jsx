import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

// Every logged game (online, ranked, vs AI, hotseat), newest first (list_games caps it at 100).
// Clicking one loads its frames and steps through them on the game screen
// (startReplay in app.js).
const name = (n) => n || 'Guest';
const MODE = { online: 'Casual', ranked: 'Ranked', ai: 'vs AI', local: 'Local' };
const delta = (d) => (d == null ? '' : ` (${d >= 0 ? '+' : ''}${d})`);

export default function HistoryPage() {
  const { profile } = useStore();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    Auth.listGames().then(({ data, error }) => {
      if (error) setError('Could not load the game history.');
      else setRows(data);
    });
  }, []);

  async function open(id) {
    setOpening(id);
    const { data, error } = await Auth.gameReplay(id);
    setOpening(null);
    if (error || !data || !data[0] || !data[0].frames.length) { setError('Could not load that game.'); return; }
    startReplay(data[0].frames);
  }

  const me = profile && profile.display_name;
  let status = error;
  if (!status && !rows) status = 'Loading…';
  else if (!status && !rows.length) status = 'No games logged yet. Finished games show up here.';

  return (
    <main className="augments-main account-main">
      <div className="page-head">
        <h1>History</h1>
        <p>Every finished game. Pick one to step through it.</p>
      </div>
      <section className="settings-card">
        <ol className="leaderboard-list">
          {(rows || []).map(g => (
            <li key={g.id}>
              <button
                className={'leaderboard-row history-row' + (me && (g.white_name === me || g.black_name === me) ? ' me' : '')}
                onClick={() => open(g.id)}
                disabled={opening === g.id}
              >
                <span className="lb-name">
                  <span className={g.result === 'w' ? 'history-winner' : ''}>{name(g.white_name)}{delta(g.white_delta)}</span>
                  {' vs '}
                  <span className={g.result === 'b' ? 'history-winner' : ''}>{name(g.black_name)}{delta(g.black_delta)}</span>
                  <span className="history-detail">
                    {MODE[g.mode]} · {g.result_text} · {g.moves} moves · {new Date(g.ended_at).toLocaleString()}
                  </span>
                </span>
                <span className="lb-rating">{opening === g.id ? '…' : '▶'}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="settings-note">{status}</p>
      </section>
    </main>
  );
}
