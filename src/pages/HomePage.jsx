import { useStore, setState, showView } from '../store.js';
import { AugmentEmblem } from '../components/augmentBits.jsx';

// Hero "board": 15 featured emblems scattered over a 5×5 grid, leaving gaps
// so it reads like pieces on a board rather than a dense icon sheet.
const FEATURED = ['archers', 'solarStrike', 'ghouls', 'kingsLightning', 'mounting',
  'silverBullet', 'watchtowers', 'raiseTheDead', 'trolls', 'ringOfFire',
  'stunlock', 'coronation', 'unstableTeleport', 'longbowmen', 'leaping'];
const FEATURED_SLOTS = [0, 2, 4, 6, 8, 10, 11, 12, 14, 16, 17, 18, 20, 22, 24];

const STEPS = [
  ['01', 'coronation', 'Set the stakes', 'Agree on a time control and how many auction points each side gets to spend.'],
  ['02', 'archers', 'Draft augments', 'Take turns picking augments. Swap your pawns for Archers or Ghouls, arm your King with Silver Bullet, or unlock follow-up upgrades.'],
  ['03', 'solarStrike', 'Play it out', 'Everything else is ordinary chess. Use abilities with Q/W/E/R for the selected unit and A/S/D/F for global powers.'],
];

// The buttons hand off to the classic scripts that still run the game
// (AiPlayer, showGameSettings, findMatch, createGameLink).
export default function HomePage() {
  const { session } = useStore();

  const startLocal = () => { AiPlayer.end(); newLocalGame(); showView('game'); showGameSettings(); };
  const playOnline = () => { AiPlayer.end(); findMatch(false); };
  const playRanked = () => {
    if (!session) { setState({ authOpen: true }); return; } // ranked needs an account
    AiPlayer.end();
    findMatch(true);
  };
  const gameLink = () => { AiPlayer.end(); createGameLink(); };

  return (
    <main className="home-main">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-eyebrow">Chess, augmented</div>
          <h1>Draft your<br /><span className="accent">edge.</span><br />Break the rules.</h1>
          <p>Classic chess, until someone bids on an augment. Before every match, both players spend points on new units, abilities and rule-breaking powers. Draft carefully: a bad draft can lose the game before the first move.</p>
          <div className="hero-buttons">
            <button className="btn btn-primary btn-lg" onClick={startLocal}>Start New Game</button>
            <button className="btn btn-secondary btn-lg" onClick={() => AiPlayer.begin()}>Play vs AI</button>
            <button className="btn btn-multiplayer btn-lg" onClick={playOnline}>Play Online</button>
            <button className="btn btn-multiplayer btn-lg" onClick={playRanked}>Play Ranked</button>
            <button className="btn btn-secondary btn-lg" onClick={gameLink}>Create Game Link</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-board">
            {Array.from({ length: 25 }, (_, i) => {
              const slot = FEATURED_SLOTS.indexOf(i);
              const aug = slot !== -1 && AUGMENTS.find(a => a.id === FEATURED[slot]);
              return (
                <div key={i} className="hero-tile">
                  {aug && <AugmentEmblem aug={aug} style={{ animationDelay: `${(i * 0.37) % 6}s` }} />}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="section-head">
        <h2>How a match works</h2>
        <p>Three phases, one winner.</p>
      </div>
      <div className="steps">
        {STEPS.map(([num, icon, title, text]) => (
          <div key={num} className="feature-card">
            <span className="step-num">{num}</span>
            <img className="emblem" src={`augments/icons/${icon}.svg`} alt="" />
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>The Arsenal</h2>
        <p>Every augment in the game. Click one for details.</p>
      </div>
      <div className="augment-marquee">
        <div className="marquee-track">
          {/* Two copies back to back so the -50% translate loops seamlessly.
              data-aug-id drives augment-demo-player.js's hover popover. */}
          {[0, 1].map(copy => AUGMENTS.map(aug => (
            <button key={`${copy}-${aug.id}`} type="button" className="marquee-item" data-aug-id={aug.id} aria-hidden={copy ? 'true' : undefined} onClick={() => showAugmentDetail(aug)}>
              <AugmentEmblem aug={aug} />{aug.name}
            </button>
          )))}
        </div>
      </div>

      <footer className="site-footer">
        <span>AugChess: chess with augmented rules.</span>
        <span>Icons by <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a> (Lorc, Delapouite et al.), <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a></span>
      </footer>
    </main>
  );
}
