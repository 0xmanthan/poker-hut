// Deals real Hold'em hands with the production shuffler and compares what comes
// out with the exact mathematical probabilities for 7-card hands.
// Usage: node scripts/fairness.js [hands=200000] [players=4]

import { newSeed, deckFromSeed } from '../engine/deck.js';
import { evaluate, category, CATEGORY_NAMES } from '../engine/evaluator.js';

const HANDS = Number(process.argv[2] ?? 200000);
const PLAYERS = Number(process.argv[3] ?? 4);

// exact 7-card category counts out of C(52,7) = 133,784,560
const EXACT = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];
const C527 = 133784560;

const counts = new Array(9).fill(0);
let tableWithTwoPairPlus = 0;
let tableWithFullHousePlus = 0;
for (let i = 0; i < HANDS; i++) {
  const deck = deckFromSeed(newSeed());
  const holes = Array.from({ length: PLAYERS }, (_, p) => [deck[p], deck[p + PLAYERS]]);
  let pos = PLAYERS * 2;
  pos++; const board = [deck[pos++], deck[pos++], deck[pos++]];
  pos++; board.push(deck[pos++]);
  pos++; board.push(deck[pos++]);
  let twoPlus = 0, fhPlus = 0;
  for (const h of holes) {
    const cat = category(evaluate([...h, ...board]));
    counts[cat]++;
    if (cat >= 2) twoPlus++;
    if (cat >= 6) fhPlus++;
  }
  if (twoPlus >= 2) tableWithTwoPairPlus++;
  if (fhPlus >= 1) tableWithFullHousePlus++;
}

const total = HANDS * PLAYERS;
console.log(`\n${HANDS.toLocaleString()} hands, ${PLAYERS} players, every player's best hand at the river\n`);
console.log('Hand              Dealt here    Real-deck math   z-score');
for (let c = 8; c >= 0; c--) {
  const p = EXACT[c] / C527;
  const obs = counts[c] / total;
  const z = (counts[c] - total * p) / Math.sqrt(total * p * (1 - p));
  console.log(`${CATEGORY_NAMES[c].padEnd(17)} ${(obs * 100).toFixed(3).padStart(8)}%    ${(p * 100).toFixed(3).padStart(8)}%      ${z.toFixed(2).padStart(6)}`);
}
console.log('\n|z| under 3 on every row means the deal matches a real deck.');
console.log(`\nAt the river, 2+ of the ${PLAYERS} players hold two pair or better: ${(tableWithTwoPairPlus / HANDS * 100).toFixed(1)}% of hands`);
console.log(`Someone holds a full house or better: ${(tableWithFullHousePlus / HANDS * 100).toFixed(1)}% of hands\n`);
