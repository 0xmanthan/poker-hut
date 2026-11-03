// 5–7 card poker hand evaluator. Returns a comparable integer score:
// category << 20 | five 4-bit rank slots (most significant first).
//
// Two rule sets:
// - Hold'em (default): the usual order.
// - Short deck (6+, 36 cards): a flush beats a full house, A-6-7-8-9 is the lowest
//   straight, and (optionally, "Triton rules") three of a kind beats a straight.
//   Pass rules = { short: true, tripsBeatStraight } to evaluate and describe.

// hand kinds, independent of how a variant orders them
const HIGH = 0, PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4, FLUSH = 5, FULL = 6, QUADS = 7, STRAIGHT_FLUSH = 8;

// kinds from weakest to strongest; a score's category is the index here
const ORDER_HOLDEM = [HIGH, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL, QUADS, STRAIGHT_FLUSH];
const ORDER_SHORT = [HIGH, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FULL, FLUSH, QUADS, STRAIGHT_FLUSH];
const ORDER_SHORT_TRIPS = [HIGH, PAIR, TWO_PAIR, STRAIGHT, TRIPS, FULL, FLUSH, QUADS, STRAIGHT_FLUSH];

const KIND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

const orderFor = (rules) => (!rules?.short ? ORDER_HOLDEM : rules.tripsBeatStraight ? ORDER_SHORT_TRIPS : ORDER_SHORT);
// category index -> kind, and kind -> category index, per rule set
const tables = new Map();
function table(rules) {
  const order = orderFor(rules);
  let t = tables.get(order);
  if (!t) { t = { order, cat: order.map((_, k) => order.indexOf(k)) }; tables.set(order, t); }
  return t;
}

// category names from weakest to strongest (Hold'em order unless rules say otherwise)
export const categoryNames = (rules) => orderFor(rules).map((k) => KIND_NAMES[k]);
export const CATEGORY_NAMES = categoryNames();

const RANK_WORDS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
const RANK_WORD = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];

const pack = (cat, r) => (cat << 20) | ((r[0] ?? 0) << 16) | ((r[1] ?? 0) << 12) | ((r[2] ?? 0) << 8) | ((r[3] ?? 0) << 4) | (r[4] ?? 0);

const WHEEL = 0b1000000001111;            // A-2-3-4-5
const SHORT_WHEEL = (1 << 12) | (0b1111 << 4); // A-6-7-8-9

// highest straight top rank in a 13-bit rank mask, or -1
function straightTop(mask, short) {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return top;
  }
  if (short) { if ((mask & SHORT_WHEEL) === SHORT_WHEEL) return 7; } // nine high
  else if ((mask & WHEEL) === WHEEL) return 3;
  return -1;
}

function topRanks(mask, n, exclude = 0) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if ((mask & (1 << r)) && !(exclude & (1 << r))) out.push(r);
  return out;
}

export function evaluate(cards, rules) {
  const { cat } = table(rules);
  const short = !!rules?.short;
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
    const sf = straightTop(flushMask, short);
    if (sf >= 0) return pack(cat[STRAIGHT_FLUSH], [sf]);
  }

  const quads = [], trips = [], pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  if (quads.length) return pack(cat[QUADS], [quads[0], topRanks(mask, 1, 1 << quads[0])[0]]);

  // every hand the cards make; the variant's order decides which is best
  let best = -1;
  const offer = (score) => { if (score > best) best = score; };
  if (trips.length && (trips.length > 1 || pairs.length)) offer(pack(cat[FULL], [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]));
  if (flushMask) offer(pack(cat[FLUSH], topRanks(flushMask, 5)));
  const st = straightTop(mask, short);
  if (st >= 0) offer(pack(cat[STRAIGHT], [st]));
  if (trips.length) offer(pack(cat[TRIPS], [trips[0], ...topRanks(mask, 2, 1 << trips[0])]));
  if (best >= 0) return best;
  if (pairs.length >= 2) {
    const [a, b] = pairs;
    return pack(cat[TWO_PAIR], [a, b, topRanks(mask, 1, (1 << a) | (1 << b))[0]]);
  }
  if (pairs.length) return pack(cat[PAIR], [pairs[0], ...topRanks(mask, 3, 1 << pairs[0])]);
  return pack(cat[HIGH], topRanks(mask, 5));
}

function popcount(x) {
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}

export const category = (score) => score >> 20;

export function describe(score, rules) {
  const kind = table(rules).order[score >> 20];
  const r = (i) => (score >> (16 - 4 * i)) & 15;
  switch (kind) {
    case STRAIGHT_FLUSH: return r(0) === 12 ? 'Royal flush' : `Straight flush, ${RANK_WORD[r(0)]} high`;
    case QUADS: return `Four ${RANK_WORDS[r(0)]}`;
    case FULL: return `Full house, ${RANK_WORDS[r(0)]} full of ${RANK_WORDS[r(1)]}`;
    case FLUSH: return `Flush, ${RANK_WORD[r(0)]} high`;
    case STRAIGHT: return `Straight, ${RANK_WORD[r(0)]} high`;
    case TRIPS: return `Three ${RANK_WORDS[r(0)]}`;
    case TWO_PAIR: return `Two pair, ${RANK_WORDS[r(0)]} and ${RANK_WORDS[r(1)]}`;
    case PAIR: return `Pair of ${RANK_WORDS[r(0)]}`;
    default: return `${RANK_WORD[r(0)]} high`;
  }
}

// Best 5-card subset (for highlighting the winning cards)
export function bestFive(cards, rules) {
  let best = { score: -1, cards: [] };
  const n = cards.length;
  const pick = (start, chosen) => {
    if (chosen.length === 5) {
      const s = evaluate(chosen, rules);
      if (s > best.score) best = { score: s, cards: [...chosen] };
      return;
    }
    for (let i = start; i <= n - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]);
  };
  if (n <= 5) return { score: evaluate(cards, rules), cards: [...cards] };
  pick(0, []);
  return best;
}
