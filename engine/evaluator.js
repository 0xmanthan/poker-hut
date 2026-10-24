// 5–7 card poker hand evaluator. Returns a comparable integer score:
// category << 20 | five 4-bit rank slots (most significant first).

export const CATEGORY_NAMES = [
  'High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight',
  'Flush', 'Full house', 'Four of a kind', 'Straight flush',
];

const RANK_WORDS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
const RANK_WORD = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];

const pack = (cat, r) => (cat << 20) | ((r[0] ?? 0) << 16) | ((r[1] ?? 0) << 12) | ((r[2] ?? 0) << 8) | ((r[3] ?? 0) << 4) | (r[4] ?? 0);

// highest straight top rank in a 13-bit rank mask, or -1
function straightTop(mask) {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return top;
  }
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3; // A-2-3-4-5
  return -1;
}

function topRanks(mask, n, exclude = 0) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if ((mask & (1 << r)) && !(exclude & (1 << r))) out.push(r);
  return out;
}

export function evaluate(cards) {
  const counts = new Array(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = c >> 2;
    counts[r]++;
    suitMask[c & 3] |= 1 << r;
    mask |= 1 << r;
  }

  let flushMask = 0;
  for (const m of suitMask) if (popcount(m) >= 5) flushMask = m;
  if (flushMask) {
    const sf = straightTop(flushMask);
    if (sf >= 0) return pack(8, [sf]);
  }

  const quads = [], trips = [], pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }

  if (quads.length) return pack(7, [quads[0], topRanks(mask, 1, 1 << quads[0])[0]]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pairRank = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(6, [trips[0], pairRank]);
  }
  if (flushMask) return pack(5, topRanks(flushMask, 5));
  const st = straightTop(mask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length) return pack(3, [trips[0], ...topRanks(mask, 2, 1 << trips[0])]);
  if (pairs.length >= 2) {
    const [a, b] = pairs;
    return pack(2, [a, b, topRanks(mask, 1, (1 << a) | (1 << b))[0]]);
  }
  if (pairs.length) return pack(1, [pairs[0], ...topRanks(mask, 3, 1 << pairs[0])]);
  return pack(0, topRanks(mask, 5));
}

function popcount(x) {
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}

export const category = (score) => score >> 20;

export function describe(score) {
  const cat = score >> 20;
  const r = (i) => (score >> (16 - 4 * i)) & 15;
  switch (cat) {
    case 8: return r(0) === 12 ? 'Royal flush' : `Straight flush, ${RANK_WORD[r(0)]} high`;
    case 7: return `Four ${RANK_WORDS[r(0)]}`;
    case 6: return `Full house, ${RANK_WORDS[r(0)]} full of ${RANK_WORDS[r(1)]}`;
    case 5: return `Flush, ${RANK_WORD[r(0)]} high`;
    case 4: return `Straight, ${RANK_WORD[r(0)]} high`;
    case 3: return `Three ${RANK_WORDS[r(0)]}`;
    case 2: return `Two pair, ${RANK_WORDS[r(0)]} and ${RANK_WORDS[r(1)]}`;
    case 1: return `Pair of ${RANK_WORDS[r(0)]}`;
    default: return `${RANK_WORD[r(0)]} high`;
  }
}

// Best 5-card subset (for highlighting the winning cards)
export function bestFive(cards) {
  let best = { score: -1, cards: [] };
  const n = cards.length;
  const pick = (start, chosen) => {
    if (chosen.length === 5) {
      const s = evaluate(chosen);
      if (s > best.score) best = { score: s, cards: [...chosen] };
      return;
    }
    for (let i = start; i <= n - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]);
  };
  if (n <= 5) return { score: evaluate(cards), cards: [...cards] };
  pick(0, []);
  return best;
}
