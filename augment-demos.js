/**
 * augment-demos.js — Animated, rules-accurate demonstrations of every augment.
 *
 * Each demo is a short script (a starting position plus a list of moves and
 * ability casts) that is played through the REAL engine via applyAction —
 * the same code the server runs — so what a player sees in a demo is exactly
 * what the augment does in a game. buildAugmentDemo() turns a script into a
 * list of frames: board snapshots with the same square/piece classes the real
 * board uses (see renderBoard in app.js), plus piece identities so the player
 * (augment-demo-player.js) can animate moves, captures and spawns.
 *
 * Dice-based augments (Unstable Fireball/Teleport, Breaking Rank) pin their
 * rolls per step (`rng`), so a demo always shows the outcome its caption
 * describes. tools/check-demos.js plays every script in Node and fails if the
 * engine rejects a step or an `expect` doesn't hold — rerun it after rules
 * changes.
 *
 * Pure: no DOM. Same dual browser-<script>/Node-require shape as data.js.
 */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const E = isNode
    ? Object.assign({},
        require('./engine/draft-engine.js'),
        require('./engine/chess-engine.js'),
        require('./engine/gameover-engine.js'),
        require('./engine/augments-engine.js'),
        require('./engine/index.js'))
    : root;

  // ═══════════════════════════════════════════════════════════════════════
  //  DEMO SCRIPTS
  // ═══════════════════════════════════════════════════════════════════════
  // position: space-separated <color><PIECE><square> tokens (wKg1 = white
  //   King on g1). turn: who moves first (default White).
  // Steps (each may carry `caption`, plus `after`, appended once the action plays):
  //   select: 'd4'                 highlight a unit and its legal moves
  //   move: 'd4-d6' [exit: true]   a move (exit = leave a tower / dismount)
  //   threat: 'd4'                 with a move: also show that archer's range
  //   quick: true                  filler reply, shown briefly
  //   arm: { key, unit }           arm a unit ability (Stunlock)
  //   target: { kind, unit, preview }  show an ability's valid targets
  //   cast: { id, ...params }      castAbility, same params as the client
  //   rng: [..]                    Math.random values for this step's action
  //   vanguard: ['d2-d5', …]       a Vanguard deployment (from-to per unit)
  //   expect: { sq: 'wP' | null } or (state) => bool
  const DEMOS = {
    leaping: {
      augments: { w: ['leaping'] },
      position: 'wKe1 wPd4 wPg2 bKe8 bRd8 bNd5 bPa7',
      steps: [
        { move: 'd4-d6', caption: 'A knight blocks this pawn, so normally it would be stuck. With Leaping Pawns it can jump two squares straight ahead…', after: '…right over the knight. This works at any time, not only from the starting row.', expect: { d6: 'wP', d4: null } },
        { move: 'a7-a6', quick: true },
        { select: 'd6', caption: 'A leap can never capture: with the rook on d8, the jump is not offered, only the normal step.' },
      ],
    },

    watchtowers: {
      augments: { w: ['watchtowers'] },
      position: 'wKe1 wRh1 wPg2 wPa2 bKe8 bPa7 bPb7',
      steps: [
        { move: 'g2-h1', caption: 'With Watchtowers, a pawn next to one of your corner rooks can step inside it: one step, any direction…', after: '…and garrisons the tower. Rook and pawn now share the square.', expect: s => s.mannedTowers.h1 === 'w' },
        { move: 'b7-b6', quick: true },
        { move: 'h1-h4', caption: 'The rook keeps moving normally and carries its garrison along.', expect: s => s.mannedTowers.h4 === 'w' },
        { move: 'b6-b5', quick: true },
        { move: 'h4-g5', exit: true, caption: 'Double-click the tower to let the pawn step out onto any free neighbouring square.', expect: { g5: 'wP', h4: 'wR' } },
      ],
    },

    mounting: {
      augments: { w: ['mounting'] },
      position: 'wKe1 wNd2 wPa2 wPb2 bKe8 bPa7 bPh7',
      steps: [
        { move: 'e1-d2', caption: 'With Mounting, your King can climb onto one of its own knights standing next to it.', expect: s => s.mounted.w === 'd2' },
        { move: 'h7-h6', quick: true },
        { move: 'd2-e4', caption: 'Mounted, the King moves like a knight. It is still your King: if it is captured, you lose.', expect: s => s.mounted.w === 'e4' },
        { move: 'h6-h5', quick: true },
        { move: 'e4-e5', exit: true, caption: 'Double-click to dismount: the King steps off onto a free neighbouring square and the knight stays behind.', expect: { e4: 'wN', e5: 'wK' } },
      ],
    },

    vanguard: {
      augments: { w: ['vanguard'] },
      position: 'wRa1 wNb1 wBc1 wQd1 wKe1 wBf1 wNg1 wRh1 wPa2 wPb2 wPc2 wPd2 wPe2 wPf2 wPg2 wPh2 '
        + 'bRa8 bNb8 bBc8 bQd8 bKe8 bBf8 bNg8 bRh8 bPa7 bPb7 bPc7 bPd7 bPe7 bPf7 bPg7 bPh7',
      steps: [
        {
          vanguard: ['d2-d5', 'e2-e5', 'b1-c4', 'g1-f4', 'c1-d3', 'f1-e3'],
          caption: 'Before the first turn, Vanguard gives you 30 free seconds to move any of your units onto your Vanguard squares (gold)…',
          after: '…then they all march out at once. Your opponent only sees the result.',
          expect: { d5: 'wP', e5: 'wP', c4: 'wN', f4: 'wN', d3: 'wB', e3: 'wB', d2: null, g1: null },
        },
        { select: 'd5', caption: 'Playing White, your Vanguard units sit out your first turn.' },
        { move: 'a2-a3', quick: true },
        { move: 'g8-f6', quick: true },
        { move: 'e5-f6', caption: 'From your second turn on, they fight like any other unit.', expect: { f6: 'wP' } },
      ],
    },

    stunlock: {
      augments: { w: ['stunlock'] },
      position: 'wKg1 wBc1 wPa2 wPb2 wPh2 bKg8 bNe5 bQe6 bPa7 bPb7',
      steps: [
        { arm: { key: 'Q', unit: 'c1' }, caption: 'Each bishop carries one Stunlock charge (⚡). Select a charged bishop, press Q to arm the spell, then move it as usual.' },
        { move: 'c1-f4', caption: 'Each bishop carries one Stunlock charge (⚡). Select a charged bishop, press Q to arm the spell, then move it as usual.', expect: s => !!s.pendingStunlock },
        {
          target: { kind: 'stunlock', unit: 'f4', preview: 'd5' }, cast: { id: 'stunlock', center: 'd5' },
          caption: 'Where it lands, pick any 2×2 block within its reach…',
          after: '…and everything inside is frozen for the next two turns, friend or foe.',
          expect: s => s.stunnedSquares.e5 > 0 && s.stunnedSquares.e6 > 0,
        },
        { select: 'e5', caption: 'Black\'s knight and queen have no moves while the chains hold.' },
        { move: 'g8-h8', quick: true },
        { move: 'h2-h3', caption: 'After both players have taken their next turn, the chains break.', expect: s => !s.stunnedSquares.e5 },
      ],
    },

    apprentices: {
      augments: { w: ['apprentices'] },
      position: 'wKg1 wPd2 wPe4 bKe8 bPe5 bNf5 bPa7',
      steps: [
        { move: 'e4-d5', caption: 'Apprentices step forward or diagonally forward, but only onto empty squares. They can never capture…', after: '…so the pawn and knight ahead are safe, and it slips past diagonally.', expect: { d5: 'wP', e5: 'bP', f5: 'bN' } },
        { move: 'a7-a6', quick: true },
        { select: 'd2', caption: 'From the starting row they can still step two squares, and they promote like normal pawns.' },
      ],
    },

    archers: {
      augments: { w: ['archers'] },
      position: 'wKg1 wPd4 wPb2 bKe8 bPd5 bNd6 bBe6 bPa7',
      steps: [
        { move: 'd4-d6', caption: 'Archers step forward or diagonally forward onto empty squares and never capture by moving. Instead they shoot…', after: '…killing an enemy on any of the three squares two rows ahead (×) without leaving their square.', expect: { d6: null, d4: 'wP' } },
        { move: 'a7-a6', quick: true },
        { select: 'd4', caption: 'Its quiver is now empty: no shot on its next turn, though it can still move. The arrows are back once it is ready again.' },
      ],
    },

    ghouls: {
      augments: { w: ['ghouls'] },
      position: 'wKg1 wPe2 wPc4 bKe8 bBe4 bNc5 bPd5 bPa7',
      steps: [
        { move: 'e2-e4', caption: 'Ghouls move and attack straight ahead, never diagonally. Two squares ahead they can charge (claw marks) if the square in between is empty…', after: '…killing the bishop and landing in its place.', expect: { e4: 'wP', e2: null } },
        { move: 'a7-a6', quick: true },
        { move: 'c4-c5', caption: 'One square ahead works too. The pawn on d5 is diagonal, so it is safe: ghouls never strike diagonally.', expect: { c5: 'wP', d5: 'bP' } },
      ],
    },

    guardsmen: {
      augments: { w: ['guardsmen'] },
      position: 'wKg1 wPd4 bKg8 bNd5 bBe5 bPc3 bPa7',
      steps: [
        { move: 'd4-e5', caption: 'Guardsmen step to any free neighbouring square, sideways and backwards too, but capture only like a pawn: forward-diagonally…', after: '…so the bishop falls, while the knight ahead and the pawn behind are safe.', expect: { e5: 'wP', d5: 'bN', c3: 'bP' } },
      ],
    },

    spearmen: {
      augments: { w: ['spearmen'] },
      position: 'wKg1 wPd4 wPb2 bKg8 bRd8 bNe5 bPa7',
      steps: [
        { move: 'd4-d5', caption: 'Spearmen move and capture only one square straight ahead, never diagonally, so the knight is out of reach. (From the starting row they can still step two.)', expect: { d5: 'wP' } },
        { move: 'd8-d5', caption: 'Attacking a spearman head-on is deadly. The rook takes it from the front…', after: '…and is impaled on the braced spear: both die.', expect: { d5: null, d8: null } },
      ],
    },

    trolls: {
      augments: { w: ['trolls'] },
      position: 'wKg1 wRd3 wPa2 bKg8 bNe5 bBf4 bPf5 bPa7',
      steps: [
        { move: 'd3-d4', caption: 'Trolls walk one square along a rank or file, and only onto open ground. They never capture by moving.' },
        { move: 'g8-h8', quick: true },
        {
          target: { kind: 'clubbing', unit: 'd4', preview: 'e4' }, cast: { id: 'clubbing', unitSq: 'd4', quadrant: 'e4' },
          caption: 'Instead they club: press Q and choose a 2×2 block beside the troll (not diagonal).',
          after: 'Every unit inside is flattened, friend or foe. Clubbing takes the whole turn, and a troll can club every turn.',
          expect: { e5: null, f4: null, f5: null, d4: 'wR' },
        },
      ],
    },

    longbowmen: {
      augments: { w: ['longbowmen'] },
      position: 'wKg1 wBd4 wPa2 bKg8 bNd6 bBf6 bPe5 bPa7 bPb7',
      steps: [
        { move: 'd4-f6', caption: 'Longbowmen step one square in any direction but never capture by moving. They shoot any unit exactly two squares away, straight or diagonal…', after: '…even right over the pawn on e5, without ever moving.', expect: { f6: null, d4: 'wB', e5: 'bP' } },
        { move: 'a7-a6', quick: true },
        { move: 'd4-d6', caption: 'No cooldown: it can shoot again on the very next turn.', expect: { d6: null } },
      ],
    },

    deviant: {
      augments: { w: ['ghouls', 'deviant'] },
      position: 'wKg1 wPd4 bKe8 bNc5 bBf6 bPd5 bPa7',
      steps: [
        { move: 'd4-f6', caption: 'With Deviant your ghouls also strike diagonally forward: step or attack one square, or charge two squares (claw marks)…', after: '…a diagonal charge needs the square in between empty, just like a straight one.', expect: { f6: 'wP', d4: null } },
      ],
    },

    breakingRank: {
      augments: { w: ['ghouls', 'breakingRank'] },
      position: 'wKg1 wPc3 wPf3 wPa2 bKe8 bNc5 bBf5 bPa7',
      steps: [
        { move: 'g1-h1', caption: 'Breaking Rank works on its own: every enemy your ghouls could charge is in danger. You just play your turn as normal.' },
        {
          move: 'a7-a6', rng: [0.05, 0.9],
          caption: 'Black replies…',
          after: '…and as your turn begins, each threatened enemy has a 1-in-6 chance to be struck down. The knight is caught: the ghoul charges in for free.',
          expect: { c5: 'wP', c3: null, f5: 'bB' },
        },
        { select: 'c5', caption: 'That ghoul is spent for this turn (💥), but your normal move is still yours to make.' },
      ],
    },

    raiseTheDead: {
      augments: { w: ['ghouls', 'raiseTheDead'] },
      position: 'wKe1 wRa1 wPa2 wPb2 wPh3 bKe8 bNc6 bPa7',
      setup: { ghoulGraveyard: { w: 2, b: 0 } },
      steps: [
        {
          target: { kind: 'raiseDead', unit: 'e1', preview: 'a3' }, cast: { id: 'raiseTheDead', target: 'a3' },
          caption: 'Two of your ghouls have fallen. Select your King and press R. You can raise them on any free square next to the King, or on the first free square of each file counting from your back row.',
          after: 'Click a square and a ghoul rises there…',
          expect: { a3: 'wP' },
        },
        {
          target: { kind: 'raiseDead', unit: 'e1', preview: 'e2' }, cast: { id: 'raiseTheDead', target: 'e2' },
          caption: '…keep raising until none are left (or press Z to stop early).',
          after: 'Then your turn ends, and the spell has to rest for a turn.',
          expect: s => s.game.get('e2') && s.game.turn() === 'b',
        },
      ],
    },

    solarStrike: {
      augments: { w: ['solarStrike'] },
      position: 'wKg1 wQd3 wPh2 wPa2 bKg8 bNe5 bBf6 bPd6 bPa7',
      steps: [
        {
          target: { kind: 'solarStrike', unit: 'd3', preview: 'e5' }, cast: { id: 'solarStrike', unitSq: 'd3', center: 'e5' },
          caption: 'Select your Queen and press Q before moving anything: mark a 3×3 area centred up to two squares away from her.',
          after: 'The strike is delayed (☀). You still have to make a move this turn, with any piece except the Queen.',
          expect: s => s.solarMarked.e5 > 0,
        },
        { move: 'h2-h3', quick: true },
        { move: 'e5-g4', caption: 'Black gets one turn to escape. Whatever is still inside when that turn ends burns.', expect: { f6: null, d6: null, g4: 'bN' } },
      ],
    },

    advance: {
      augments: { w: ['advance'] },
      position: 'wKg1 wPa2 wPb3 wPc2 wPd4 wPf2 wPg2 wPh2 bKe8 bPd5 bPa7',
      steps: [
        {
          cast: { id: 'advance' },
          caption: 'Advance is a global ability: press its slot (A/S/D/F) instead of making a move.',
          after: 'Every pawn steps one square forward at once. A pawn with no free square ahead stays put. Once per game, and it uses your turn.',
          expect: { a3: 'wP', b4: 'wP', d4: 'wP', h3: 'wP' },
        },
      ],
    },

    silverBullet: {
      augments: { w: ['silverBullet'] },
      position: 'wKd3 wPf5 wPa2 bKh8 bNd6 bPb5 bNg3 bNg6 bPa7',
      steps: [
        {
          target: { kind: 'silverBullet', unit: 'd3', preview: 'd6' }, cast: { id: 'silverBullet', unitSq: 'd3', center: 'd6' },
          caption: 'Select your King and press Q: hit any enemy up to three squares away in a straight or diagonal line. The first unit in a line blocks the rest, so your own pawn covers the knight on g6.',
          after: 'One shot, once per game, and it uses your turn.',
          expect: { d6: null, g6: 'bN' },
        },
      ],
    },

    kingsLightning: {
      augments: { w: ['kingsLightning'] },
      position: 'wKe4 wPd3 wPa2 bKh8 bNf5 bRd6 bPa7',
      steps: [
        {
          cast: { id: 'kingsLightning' },
          caption: 'Press Lightning Aura (A/S/D/F): lightning surrounds your King for the rest of the game.',
          after: 'Any unit standing next to your King when a turn ends is executed, friend or foe. The knight and your own pawn are both gone.',
          expect: { f5: null, d3: null },
        },
        { move: 'h8-h7', quick: true },
        { move: 'e4-e5', caption: 'The aura moves with the King, so walking up to an enemy is an attack.', expect: { d6: null, e5: 'wK' } },
      ],
    },

    ringOfFire: {
      augments: { w: ['ringOfFire'] },
      position: 'wKe4 wPe3 wPa2 bKh8 bNf5 bNd5 bPa7',
      steps: [
        {
          cast: { id: 'ringOfFire' },
          caption: 'Press Ring of Fire (A/S/D/F): flames surround your King for the rest of the game.',
          after: 'Units inside start to smoulder (🔥), friend or foe.',
          expect: s => s.fireAura.f5 && s.fireAura.f5.turns === 1,
        },
        {
          move: 'd5-b4',
          caption: 'A unit that steps out in time is safe…',
          after: '…but anything still inside at the end of the next turn burns.',
          expect: { b4: 'bN', f5: null, e3: null },
        },
      ],
    },

    inferno: {
      augments: { w: ['ringOfFire', 'inferno'] },
      position: 'wKe4 wPa2 bKh8 bNg6 bRc6 bPa7',
      steps: [
        {
          cast: { id: 'ringOfFire' },
          caption: 'With Inferno your Ring of Fire reaches two squares out: 24 squares instead of 8.',
          after: 'The rook and knight two squares away are now smouldering too.',
          expect: s => s.fireAura.g6 && s.fireAura.c6,
        },
        { move: 'h8-h7', caption: 'They stay put…', after: '…and burn at the end of the turn.', expect: { g6: null, c6: null } },
      ],
    },

    relentlessAdvance: {
      augments: { w: ['relentlessAdvance'] },
      position: 'wKg1 wPb3 wPe4 bKh8 bPe5 bPa7',
      steps: [
        {
          cast: { id: 'relentlessAdvance' },
          caption: 'Press Relentless Advance (A/S/D/F) to commit your army. It uses your turn.',
          after: 'From now on, at the end of each of your turns, 2 random pawns march forward on their own. A pawn blocked by an enemy strikes it down instead.',
          expect: { b4: 'wP', e5: 'wP', e4: null },
        },
        { move: 'h8-g8', quick: true },
        { move: 'g1-h1', caption: 'You make your normal move, and the march continues.', expect: { b5: 'wP', e6: 'wP' } },
      ],
    },

    coronation: {
      augments: { w: ['coronation'] },
      position: 'wKe6 wPa2 bKa5 bRb1 bPh7',
      steps: [
        { move: 'e6-e7', caption: 'With Coronation, getting your King onto the enemy\'s back row wins the game on the spot.' },
        { move: 'h7-h6', quick: true },
        { move: 'e7-d8', caption: 'No checkmate needed: the King steps onto the back row…', after: '…and White wins immediately.', expect: s => s.gameOver },
      ],
    },

    unstableFireball: {
      augments: { w: ['apprentices', 'unstableFireball'] },
      position: 'wKg1 wPc3 wPf3 bKe8 bNc5 bBf5 bPa7',
      steps: [
        {
          target: { kind: 'fireball', unit: 'c3', preview: 'c5' }, cast: { id: 'unstableFireball', unitSq: 'c3', center: 'c5' }, rng: [0.5],
          caption: 'Select an Apprentice and press Q to hurl a fireball at the enemy exactly two squares ahead (the square between must be empty).',
          after: '4 times in 6 it works as intended: the target is destroyed.',
          expect: { c5: null, c3: 'wP' },
        },
        { move: 'a7-a6', quick: true },
        {
          target: { kind: 'fireball', unit: 'f3', preview: 'f5' }, cast: { id: 'unstableFireball', unitSq: 'f3', center: 'f5' }, rng: [0.25],
          caption: 'But the magic is unstable…',
          after: '…1 time in 6 it fizzles and only the Apprentice dies. 1 time in 6 it backfires and both die.',
          expect: { f3: null, f5: 'bB' },
        },
      ],
    },

    unstableTeleport: {
      augments: { w: ['apprentices', 'unstableTeleport'] },
      position: 'wKg1 wPd2 wPb2 wPa2 bKe8 bPe7 bPd7 bNc6',
      steps: [
        {
          target: { kind: 'teleport', unit: 'd2', preview: 'e5' }, cast: { id: 'unstableTeleport', unitSq: 'd2', center: 'e5' }, rng: [0.3],
          caption: 'Select an Apprentice and press its ability key: it can teleport to any free square except the two rows nearest the enemy.',
          after: '9 times in 12 it lands exactly where you aimed. Each Apprentice can teleport only once (blue dot = still ready).',
          expect: { e5: 'wP', d2: null },
        },
        { move: 'e8-f8', quick: true },
        {
          target: { kind: 'teleport', unit: 'b2', preview: 'b5' }, cast: { id: 'unstableTeleport', unitSq: 'b2', center: 'b5' }, rng: [0.8, 0],
          caption: 'But the magic is unstable…',
          after: '…1 time in 12 it drifts to a square next to the target, 1 in 12 it scatters anywhere, and 1 in 12 the Apprentice is lost.',
          expect: { a4: 'wP', b5: null, b2: null },
        },
      ],
    },

    kingsguard: {
      augments: { w: ['guardsmen', 'kingsguard'] },
      position: 'wKg1 wPd4 bKg8 bNd5 bPc3 bBe4 bPa7',
      steps: [
        { move: 'd4-c3', caption: 'With Kingsguard your Guardsmen capture on every neighbouring square, like a King: ahead, behind, sideways and diagonally…', after: '…even backwards.', expect: { c3: 'wP', d4: null } },
      ],
    },

    quickdraw: {
      augments: { w: ['archers', 'quickdraw'] },
      position: 'wKg1 wPd4 bKe8 bNc6 bBe6 bPa7',
      steps: [
        { move: 'd4-c6', caption: 'Normally an archer has to rest for a turn after shooting.', expect: { c6: null } },
        { move: 'a7-a6', quick: true },
        { move: 'd4-e6', caption: 'With Quickdraw it can shoot again on the very next turn. Every turn, no cooldown.', expect: { e6: null } },
      ],
    },

    swift: {
      augments: { w: ['archers', 'swift'] },
      position: 'wKg1 wPd4 bKe8 bNd6 bPa7',
      steps: [
        { move: 'd4-d6', caption: 'With Swift, shooting no longer ends your turn…', expect: s => !s.game.get('d6') && s.game.turn() === 'w' },
        { move: 'd4-c5', caption: '…the same archer may also take one step before the turn passes, or you can end the turn right there. It never grants a second shot.', expect: { c5: 'wP' } },
      ],
    },

    nimble: {
      augments: { w: ['archers', 'nimble'] },
      position: 'wKg1 wPd4 bKe8 bPd6 bPc5 bPa7',
      steps: [
        { move: 'd4-d3', caption: 'With Nimble, archers can also step straight sideways or straight back: every direction except the rear diagonals…', after: '…handy for slipping out of danger. Their shot never changes.', expect: { d3: 'wP' } },
      ],
    },

    warmWelcome: {
      augments: { w: ['archers', 'warmWelcome'] },
      position: 'wKg1 wPd4 bKe8 bNb8 bPa7',
      turn: 'b',
      steps: [
        {
          move: 'b8-c6', threat: 'd4',
          caption: 'Warm Welcome is a passive trap. Your archers threaten the three squares two rows ahead (×), and an enemy that moves onto one…',
          after: '…is shot down at the end of that same turn, for free. The trap then needs 4 of your turns to reset.',
          expect: { c6: null },
        },
      ],
    },
  };

  // Unit abilities that aren't augments themselves show their granting
  // augment's demo (the Troll demo covers Clubbing).
  const DEMO_ALIASES = { clubbing: 'trolls' };

  function demoIdFor(id) {
    return DEMO_ALIASES[id] || id;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SETUP
  // ═══════════════════════════════════════════════════════════════════════
  const FILES = 'abcdefgh';
  const TOWER_SQS = ['a1', 'h1', 'a8', 'h8'];
  const SIDE_NAMES = { w: 'White', b: 'Black' };

  // Deterministic stand-in for Math.random while a demo runs: the step's own
  // pinned rolls first, then a fixed LCG — the same frames every time, in the
  // browser and in tools/check-demos.js alike.
  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  function withRandom(queue, fallback, fn) {
    const orig = Math.random;
    const q = queue ? queue.slice() : [];
    Math.random = () => (q.length ? q.shift() : fallback());
    try {
      const result = fn();
      if (q.length) throw new Error(`${q.length} pinned roll(s) were never used`);
      return result;
    } finally {
      Math.random = orig;
    }
  }

  function positionToFen(position, turn) {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (const token of position.trim().split(/\s+/)) {
      const m = /^([wb])([KQRBNP])([a-h][1-8])$/.exec(token);
      if (!m) throw new Error(`Bad position token "${token}"`);
      const [, color, type, sq] = m;
      const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
      if (grid[r][f]) throw new Error(`Two pieces on ${sq}`);
      grid[r][f] = color === 'w' ? type : type.toLowerCase();
    }
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        if (!grid[r][f]) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += grid[r][f];
      }
      rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} ${turn || 'w'} - - 0 1`;
  }

  function forEachPiece(state, fn) {
    const board = state.game.board();
    for (let br = 0; br < 8; br++) {
      for (let bf = 0; bf < 8; bf++) {
        const cell = board[br][bf];
        if (cell) fn(FILES[bf] + (8 - br), cell);
      }
    }
  }

  function createDemoState(demo, rand) {
    const state = E.createRoomState();
    state.augments = { w: [...(demo.augments.w || [])], b: [...(demo.augments.b || [])] };
    state.phase = 'playing';
    withRandom(null, rand, () => E.newGame(state));
    const fen = positionToFen(demo.position, demo.turn);
    if (state.game.load(fen) === false) throw new Error(`chess.js rejected position ${fen}`);

    // newGame seeds Stunlock charges and ghoul artwork for the standard
    // opening squares — redo both for this custom position.
    state.stunlockCharges = { w: {}, b: {} };
    state.ghoulSkin = { w: {}, b: {} };
    forEachPiece(state, (sq, p) => {
      if (p.type === 'b' && E.has(state, p.color, 'stunlock')) state.stunlockCharges[p.color][sq] = true;
      if (p.type === 'p' && E.figurePawnType(state, p.color) === 'ghoul') {
        state.ghoulSkin[p.color][sq] = (FILES.indexOf(sq[0]) * 3 + +sq[1]) % 5;
      }
    });
    for (const [key, value] of Object.entries(demo.setup || {})) state[key] = JSON.parse(JSON.stringify(value));
    return state;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  SNAPSHOTS
  // ═══════════════════════════════════════════════════════════════════════
  // Mirrors figureImageKey in app.js.
  function figureKey(state, type, color) {
    if (type === 'p') {
      const fig = E.figurePawnType(state, color);
      if (fig === 'spearman' || fig === 'archer' || fig === 'ghoul') return fig;
    }
    if (type === 'b' && E.figureBishopType(state, color) === 'longbowman') return 'longbowman';
    if (type === 'r' && E.figureRookType(state, color) === 'troll') return 'troll';
    return null;
  }

  function snapshotPieces(state) {
    const pieces = [];
    forEachPiece(state, (sq, cell) => {
      const { color, type } = cell;
      const mounted = type === 'k' && state.mounted[color] === sq;
      const fig = mounted ? null : figureKey(state, type, color);
      const p = {
        sq, color, type, fig,
        // Identity key for matching across frames — a mounted King sits on
        // (and is drawn as) its knight, so it matches as one.
        match: mounted ? 'n' : type,
        mounted,
        tower: state.mannedTowers[sq] ? (state.mannedTowerOrigin[sq] === 'b' ? 'b' : 'p') : null,
        badges: [],
      };
      if (fig === 'ghoul') p.skin = state.ghoulSkin[color][sq] || 0;
      if (type === 'b' && E.has(state, color, 'stunlock') && state.stunlockCharges[color][sq]) p.badges.push('stun');
      if (type === 'p' && E.figurePawnType(state, color) === 'apprentice' &&
          E.has(state, color, 'unstableTeleport') && !state.apprenticeTeleportUsed[color][sq]) p.badges.push('teleport');
      if (type === 'p' && E.figurePawnType(state, color) === 'archer' && E.isArcherOnCooldown(state, color, sq)) p.badges.push('cooldown');
      if (state.vanguardLocked && state.vanguardLocked.includes(sq)) p.badges.push('vanguard');
      pieces.push(p);
    });
    return pieces;
  }

  // Valid target squares for an ability's targeting step, the chosen
  // `preview`, and a few alternative choices (`cycle`) the player sweeps the
  // highlight through before settling, like a player weighing options.
  function targetSquares(state, target) {
    const color = state.pendingStunlock ? state.pendingStunlock.color : state.game.turn();
    let choices;
    switch (target.kind) {
      case 'stunlock':
        choices = E.getStunlockQuadrants(target.unit).map(q => ({ key: E.frToSq(q.f, q.r), squares: E.quadrantSquares(q.f, q.r) }));
        break;
      case 'clubbing':
        choices = E.getClubbingQuadrants(target.unit).map(q => ({ key: E.frToSq(q.f, q.r), squares: E.quadrantSquares(q.f, q.r) }));
        break;
      case 'solarStrike':
        choices = E.getSolarStrikeCenters(target.unit).map(c => ({ key: E.frToSq(c.f, c.r), squares: E.solarStrikeSquares(c.f, c.r) }));
        break;
      case 'silverBullet': choices = E.getSilverBulletTargets(state, target.unit, color).map(sq => ({ key: sq, squares: [sq] })); break;
      case 'fireball': choices = E.getFireballTargets(state, target.unit, color).map(sq => ({ key: sq, squares: [sq] })); break;
      case 'teleport': choices = E.getTeleportTargets(state, color).map(sq => ({ key: sq, squares: [sq] })); break;
      case 'raiseDead': choices = E.getRaiseTheDeadTargets(state, color).map(sq => ({ key: sq, squares: [sq] })); break;
      default: throw new Error(`Unknown target kind ${target.kind}`);
    }
    const chosen = choices.find(c => c.key === target.preview);
    if (!chosen) throw new Error(`${target.preview} is not a valid ${target.kind} target`);
    const others = choices.filter(c => c !== chosen);
    const picks = [];
    for (let i = 0; i < Math.min(3, others.length); i++) picks.push(others[Math.floor((i + 0.5) * others.length / Math.min(3, others.length))]);
    return {
      kind: target.kind,
      valid: Array.from(new Set(choices.flatMap(c => c.squares))),
      preview: chosen.squares,
      cycle: picks.map(c => c.squares).concat([chosen.squares]),
    };
  }

  const TARGET_CLASSES = {
    stunlock: 'stunlock', clubbing: 'clubbing', solarStrike: 'solarstrike', silverBullet: 'silverbullet',
    fireball: 'fireball', teleport: 'teleport', raiseDead: 'raisedead',
  };

  // Per-square class lists — the same classes renderBoard (app.js) applies,
  // so the demo board is styled by the very same CSS as the real one.
  function squareClasses(state, ann) {
    const cls = {};
    const add = (sq, c) => { (cls[sq] = cls[sq] || []).push(c); };
    const turn = state.game.turn();

    if (E.has(state, 'w', 'watchtowers') || E.has(state, 'b', 'watchtowers')) TOWER_SQS.forEach(sq => add(sq, 'tower'));
    if (state.lastMove) { add(state.lastMove.from, 'last-move'); add(state.lastMove.to, 'last-move'); }
    if (ann.selected) add(ann.selected, 'selected');
    if (state.armedAbility) add(state.armedAbility.unitSq, 'demo-armed');

    for (const m of ann.legal || []) {
      if (m.special === 'archerShoot' || m.special === 'longbowmanShoot') add(m.to, 'legal-shoot');
      else if (m.special === 'ghoulCharge' || m.special === 'ghoulDiagCharge') add(m.to, 'legal-claw');
      else {
        const occ = E.pieceAt(state, m.to);
        add(m.to, (occ && occ.color !== turn) || m.captured ? 'legal-capture' : 'legal-move');
      }
    }
    const taken = new Set((ann.legal || []).map(m => m.to));
    (ann.shootRange || []).forEach(sq => { if (!taken.has(sq)) add(sq, 'shoot-range-preview'); });
    (ann.clawRange || []).forEach(sq => { if (!taken.has(sq)) add(sq, 'claw-range-preview'); });
    if (ann.aim) add(ann.aim, 'demo-aim');
    (ann.zone || []).forEach(sq => add(sq, 'vanguard-zone'));

    if (ann.target) {
      const base = TARGET_CLASSES[ann.target.kind];
      ann.target.valid.forEach(sq => add(sq, base + '-target'));
      ann.target.preview.forEach(sq => add(sq, base + '-preview'));
    }

    if (!state.mounted.w && !state.mounted.b && !E.anyFigurePawnsInPlay(state) && !E.anyFigureRooksInPlay(state) &&
        !E.anyFigureBishopsInPlay(state) && state.game.in_check()) {
      const k = E.findKingSquare(state, turn);
      if (k) add(k, 'in-check');
    }

    for (const sq of Object.keys(state.stunnedSquares)) if (state.stunnedSquares[sq] > 0) add(sq, 'stunned');
    state.ghoulBrokeRank[turn].forEach(sq => add(sq, 'broke-rank'));
    for (const sq of Object.keys(state.solarMarked)) if (state.solarMarked[sq] > 0) add(sq, 'solar-marked');
    for (const sq of Object.keys(state.teleportMarked)) if (state.teleportMarked[sq] > 0) add(sq, 'teleport-marked');
    for (const sq of Object.keys(state.fireDeathMarked)) if (state.fireDeathMarked[sq] > 0) add(sq, 'fire-death-marked');
    for (const sq of Object.keys(state.warmWelcomeMarked)) if (state.warmWelcomeMarked[sq] > 0) add(sq, 'warm-welcome-marked');

    for (const color of ['w', 'b']) {
      const kingSq = state.mounted[color] || E.findKingSquare(state, color);
      if (!kingSq) continue;
      if (state.lightningActive[color]) {
        add(kingSq, 'lightning-king');
        E.kingAuraSquares(kingSq).forEach(sq => add(sq, 'lightning-zone'));
      }
      if (state.fireActive[color]) {
        add(kingSq, 'fire-king');
        E.kingAuraSquares(kingSq, E.ringOfFireRadius(state, color)).forEach(sq => add(sq, 'fire-zone'));
      }
    }
    for (const sq of Object.keys(state.fireAura)) if (state.fireAura[sq].turns >= 1) add(sq, 'fire-priming');
    return cls;
  }

  // Legal-move highlights for a selected square, mirroring renderBoard's
  // selection overlays (shoot/charge range previews included).
  function selectionAnnotations(state, sq, exit) {
    const piece = E.pieceAt(state, sq);
    const legal = exit ? E.generateExitMoves(state, sq) : E.generateMoves(state, sq);
    const ann = { selected: sq, legal };
    const tower = state.mannedTowers[sq];
    if (tower) {
      if (state.mannedTowerOrigin[sq] === 'b') ann.shootRange = E.longbowShootRangeSquares(sq);
      else if (E.figurePawnType(state, tower) === 'archer') ann.shootRange = E.archerShootRangeSquares(sq, tower);
    } else if (piece && piece.type === 'p') {
      const fig = E.figurePawnType(state, piece.color);
      if (fig === 'archer') ann.shootRange = E.archerShootRangeSquares(sq, piece.color);
      else if (fig === 'ghoul') ann.clawRange = E.ghoulChargeSquares(state, sq, piece.color);
    } else if (piece && piece.type === 'b' && E.figureBishopType(state, piece.color) === 'longbowman') {
      ann.shootRange = E.longbowShootRangeSquares(sq);
    }
    return ann;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PIECE IDENTITY (for animation)
  // ═══════════════════════════════════════════════════════════════════════
  function chebyshev(a, b) {
    return Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(+a[1] - +b[1]));
  }

  // Works out which piece in `next` is which piece in `prev`: same square
  // first, then the move's own from→to, then nearest same-kind piece (mass
  // moves like Advance, Breaking Rank charges). Whatever is left over in
  // `prev` was removed; in `next`, spawned.
  function trackPieces(prev, next, hint, state, counter) {
    const oldLeft = new Set(prev);
    const newLeft = new Set(next);
    const pair = (o, n, moved) => {
      n.id = o.id;
      if (moved && o.sq !== n.sq) n.from = o.sq;
      oldLeft.delete(o); newLeft.delete(n);
    };

    for (const n of next) {
      const o = prev.find(o => oldLeft.has(o) && o.sq === n.sq && o.color === n.color && o.match === n.match);
      if (o) pair(o, n, false);
    }
    for (const { from, to } of hint.pairs || []) {
      const o = [...oldLeft].find(o => o.sq === from);
      const n = o && [...newLeft].find(n => n.sq === to && n.color === o.color);
      if (o && n) pair(o, n, true);
    }
    if (hint.from && hint.to && !hint.blink) {
      const o = [...oldLeft].find(o => o.sq === hint.from);
      const n = o && [...newLeft].find(n => n.sq === hint.to && n.color === o.color);
      if (o && n) pair(o, n, true);
    }
    if (!hint.blink) {
      const pairs = [];
      for (const n of newLeft) for (const o of oldLeft) {
        if (o.color === n.color && o.type === n.type) pairs.push({ o, n, d: chebyshev(o.sq, n.sq) });
      }
      pairs.sort((a, b) => a.d - b.d);
      for (const { o, n } of pairs) if (oldLeft.has(o) && newLeft.has(n)) pair(o, n, true);
    }

    for (const n of newLeft) {
      n.id = ++counter.n;
      n.spawn = hint.raise ? 'rise' : hint.blink ? 'blink' : 'fade';
      if (hint.exit && hint.from) n.spawnFrom = hint.from;
    }

    const lightning = new Set();
    for (const color of ['w', 'b']) {
      const k = state.lightningActive[color] && (state.mounted[color] || E.findKingSquare(state, color));
      if (k) E.kingAuraSquares(k).forEach(sq => lightning.add(sq));
    }
    const removed = [...oldLeft].map(o => {
      const r = { ...o };
      // The mover itself vanishing: it walked into a tower / onto its knight
      // (merge), or was impaled where it landed — slide it there first.
      if (hint.from === o.sq && hint.to && !hint.blink) {
        r.into = hint.to;
        const landed = next.find(n => n.sq === hint.to && n.color === o.color);
        r.style = landed ? 'merge' : 'die';
      } else if (hint.blink) r.style = 'blink';
      else if (state.fireDeathMarked[o.sq] > 0) r.style = 'burn';
      else if (state.warmWelcomeMarked[o.sq] > 0) r.style = 'shot';
      else if (lightning.has(o.sq)) r.style = 'zap';
      else r.style = 'die';
      return r;
    });
    return removed;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  FRAME BUILDER
  // ═══════════════════════════════════════════════════════════════════════
  function parseMove(step) {
    const [from, to] = step.move.split('-');
    return { from, to };
  }

  function checkExpect(state, expect, label) {
    if (!expect) return;
    if (typeof expect === 'function') {
      if (!expect(state)) throw new Error(`${label}: expectation failed`);
      return;
    }
    for (const [sq, want] of Object.entries(expect)) {
      const p = E.pieceAt(state, sq);
      const got = p ? p.color + p.type.toUpperCase() : null;
      if (got !== want) throw new Error(`${label}: expected ${want || 'empty'} on ${sq}, found ${got || 'empty'}`);
    }
  }

  function buildAugmentDemo(id) {
    const demoId = demoIdFor(id);
    const demo = DEMOS[demoId];
    if (!demo) return null;

    const rand = lcg(demoId.length * 7919 + 17);
    const state = createDemoState(demo, rand);
    const counter = { n: 0 };
    const frames = [];
    let pieces = snapshotPieces(state);
    pieces.forEach(p => { p.id = ++counter.n; });

    const emit = (kind, caption, side, ann, extra) => {
      frames.push(Object.assign({
        kind, caption, side,
        pieces: pieces.map(p => ({ ...p })),
        squares: squareClasses(state, ann || {}),
        banner: state.gameOver ? state.gameOverText.replace(/^\S+\s/, '') : null,
        removed: [], fx: [],
      }, extra || {}));
    };

    demo.steps.forEach((step, i) => {
      const label = `${demoId} step ${i + 1}`;
      const actor = state.vanguard ? state.vanguard.color : state.pendingStunlock ? state.pendingStunlock.color : state.game.turn();
      const quickCaption = `${SIDE_NAMES[actor]} moves.`;

      if (step.select && !step.move) {
        const p = E.pieceAt(state, step.select);
        emit('select', step.caption, p ? p.color : actor, selectionAnnotations(state, step.select, false));
        return;
      }

      // Pre-frame: what the player is about to do.
      let action, hint = {}, fx = [];
      if (step.move) {
        const { from, to } = parseMove(step);
        const ann = selectionAnnotations(state, from, !!step.exit);
        const move = ann.legal.find(m => m.to === to);
        if (!move) throw new Error(`${label}: ${step.move} is not a legal move per the engine`);
        ann.aim = to;
        if (step.threat) {
          // Also show another unit's shot range (the trap a move walks into).
          const owner = E.pieceAt(state, step.threat).color;
          ann.shootRange = (ann.shootRange || []).concat(E.archerShootRangeSquares(step.threat, owner));
        }
        if (!step.quick) emit('pre', step.caption, actor, ann);
        action = { type: 'move', from, to, exit: !!step.exit, promotion: move.needsPromo ? 'q' : undefined };
        hint = { from, to, exit: !!step.exit };
        if (move.special === 'archerShoot' || move.special === 'longbowmanShoot') fx.push({ kind: 'shot', from, to });
      } else if (step.vanguard) {
        const placements = step.vanguard.map(s => { const [from, to] = s.split('-'); return { from, to }; });
        emit('pre', step.caption, actor, { zone: E.VANGUARD_ZONES[actor] });
        action = { type: 'vanguardDeploy', placements };
        hint = { pairs: placements };
      } else if (step.arm) {
        action = { type: 'armAbility', key: step.arm.key, unitSq: step.arm.unit };
      } else if (step.cast) {
        const ann = step.target ? { target: targetSquares(state, step.target), selected: step.target.unit } : {};
        emit('pre', step.caption, actor, ann, ann.target
          ? { targetCycle: { cls: TARGET_CLASSES[ann.target.kind] + '-preview', sets: ann.target.cycle } }
          : null);
        action = Object.assign({ type: 'castAbility' }, step.cast);
        if (step.cast.id === 'unstableTeleport') hint = { blink: true };
        if (step.cast.id === 'raiseTheDead') hint = { raise: true };
        if (step.cast.id === 'unstableFireball') fx.push({ kind: 'fireball', from: step.cast.unitSq, to: step.cast.center });
        if (step.cast.id === 'silverBullet') fx.push({ kind: 'bullet', from: step.cast.unitSq, to: step.cast.center });
      } else {
        throw new Error(`${label}: step has nothing to do`);
      }

      const err = withRandom(step.rng, rand, () => E.applyAction(state, actor, action));
      if (err) throw new Error(`${label}: engine rejected the step: ${err}`);
      checkExpect(state, step.expect, label);
      if (state.gameOver && i < demo.steps.length - 1) throw new Error(`${label}: game ended early (${state.gameOverText})`);

      const next = snapshotPieces(state);
      const removed = trackPieces(pieces, next, hint, state, counter);
      pieces = next;
      const ann = step.arm ? { selected: step.arm.unit } : {};
      const kind = step.quick ? 'quick' : 'result';
      // The step's caption carries over onto its result; `after` is appended.
      const caption = step.quick ? quickCaption : step.caption;
      emit(kind, caption, actor, ann, { removed, fx, after: step.quick ? null : (step.after || null) });
    });

    return frames;
  }

  const cache = {};
  function getAugmentDemo(id) {
    const key = demoIdFor(id);
    if (!(key in cache)) cache[key] = buildAugmentDemo(key);
    return cache[key];
  }

  // snapshotPieces/trackPieces are also used by board-anim.js to animate real turns.
  const exportsObj = {
    AUGMENT_DEMOS: DEMOS, buildAugmentDemo, getAugmentDemo, demoIdFor, positionToFen,
    snapshotBoardPieces: snapshotPieces, trackBoardPieces: trackPieces,
  };
  if (isNode) module.exports = exportsObj;
  else Object.assign(root, exportsObj);
})(typeof window !== 'undefined' ? window : globalThis);
