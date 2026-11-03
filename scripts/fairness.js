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
// pocket pairs, in both decks, plus whether one hand's pair makes the next more likely
const pairOdds = { nlhe: 3 / 51, shortdeck: 3 / 35 };
const pocket = { nlhe: 0, shortdeck: 0 };
let afterPair = 0, afterPairHits = 0, lastPair = false;
const isPair = (a, b) => a >> 2 === b >> 2;
for (let i = 0; i < HANDS; i++) {
  const deck = deckFromSeed(newSeed());
  const holes = Array.from({ length: PLAYERS }, (_, p) => [deck[p], deck[p + PLAYERS]]);
  let pos = PLAYERS * 2;
  pos++; const board = [deck[pos++], deck[pos++], deck[pos++]];
  pos++; board.push(deck[pos++]);
  pos++; board.push(deck[pos++]);
  let twoPlus = 0, fhPlus = 0;
  const pairNow = isPair(holes[0][0], holes[0][1]);
  if (lastPair) { afterPair++; if (pairNow) afterPairHits++; }
  lastPair = pairNow;
  const sd = deckFromSeed(newSeed(), 'shortdeck');
  for (let p = 0; p < PLAYERS; p++) if (isPair(sd[p], sd[p + PLAYERS])) pocket.shortdeck++;
  for (const h of holes) {
    if (isPair(h[0], h[1])) pocket.nlhe++;
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
const zOf = (k, n, p) => ((k - n * p) / Math.sqrt(n * p * (1 - p))).toFixed(2);
console.log('Pocket pairs (fresh shuffle every hand)   dealt     exact      z');
console.log(`  Hold'em, 52 cards                       ${(pocket.nlhe / total * 100).toFixed(2)}%    ${(pairOdds.nlhe * 100).toFixed(2)}%  ${zOf(pocket.nlhe, total, pairOdds.nlhe).padStart(6)}   (1 in 17 hands)`);
console.log(`  Short deck, 36 cards                    ${(pocket.shortdeck / total * 100).toFixed(2)}%    ${(pairOdds.shortdeck * 100).toFixed(2)}%  ${zOf(pocket.shortdeck, total, pairOdds.shortdeck).padStart(6)}   (1 in 11.7 hands)`);
console.log(`  Pair right after a pair (same seat)     ${(afterPairHits / afterPair * 100).toFixed(2)}%    ${(pairOdds.nlhe * 100).toFixed(2)}%  ${zOf(afterPairHits, afterPair, pairOdds.nlhe).padStart(6)}   (no memory between hands)\n`);
