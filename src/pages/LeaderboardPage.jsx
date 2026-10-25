import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

// Re-fetched on every visit; the RPC caps it at 100 rows.
export default function LeaderboardPage() {
  const { profile } = useStore();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Auth.leaderboard().then(({ data, error }) => {
      if (error) setError(true);
      else setRows(data);
    });
  }, []);

  const me = profile && profile.display_name;
  let status = '';
  if (error) status = 'Could not load the leaderboard.';
  else if (!rows) status = 'Loading…';
  else if (!rows.length) status = 'No rated players yet — set a display name in Settings to appear here.';

  return (
    <main className="augments-main account-main">
      <div className="page-head">
        <h1>Leaderboards</h1>
        <p>Top rated players. Everyone starts at 1200.</p>
      </div>
      <section className="settings-card">
        <ol className="leaderboard-list">
          {(rows || []).map((row, i) => (
            <li key={row.display_name} className={'leaderboard-row' + (row.display_name === me ? ' me' : '')}>
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-name">{row.display_name}</span>
              <span className="lb-rating">{row.rating}</span>
            </li>
          ))}
        </ol>
        <p className="settings-note">{status}</p>
      </section>
    </main>
  );
}
