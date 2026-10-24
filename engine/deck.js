// Fair, verifiable shuffling.
//
// Every hand gets a fresh 256-bit seed from the OS CSPRNG (crypto.randomBytes).
// The deck is derived from that seed with an HMAC-SHA256 stream and an unbiased
// Fisher–Yates shuffle (rejection sampling, no modulo bias). Before any card is
// dealt the server publishes sha256(seed). When the session ends the seeds are
// revealed, so any player can recompute every deck and check nothing was swapped.
//
// There is no weighting, no "action" logic, no memory between hands: one
// standard 52-card deck, shuffled uniformly, dealt from the top like a real dealer.

import crypto from 'node:crypto';

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

// card id 0..51 -> rank = id >> 2 (0 = deuce .. 12 = ace), suit = id & 3
export const cardToString = (c) => RANKS[c >> 2] + SUITS[c & 3];
export const stringToCard = (s) => (RANKS.indexOf(s[0]) << 2) | SUITS.indexOf(s[1]);

export function newSeed() {
  return crypto.randomBytes(32).toString('hex');
}

export function commitment(seedHex) {
  return crypto.createHash('sha256').update(Buffer.from(seedHex, 'hex')).digest('hex');
}

// Deterministic CSPRNG stream: block i = HMAC-SHA256(seed, "poker-hut:" + i)
function makeRng(seedHex) {
  const key = Buffer.from(seedHex, 'hex');
  let block = 0;
  let buf = Buffer.alloc(0);
  let off = 0;
  const nextU32 = () => {
    if (off + 4 > buf.length) {
      buf = crypto.createHmac('sha256', key).update(`poker-hut:${block++}`).digest();
      off = 0;
    }
    const v = buf.readUInt32BE(off);
    off += 4;
    return v;
  };
  // uniform integer in [0, n) without modulo bias
  return (n) => {
    const limit = Math.floor(0x100000000 / n) * n;
    let v;
    do v = nextU32(); while (v >= limit);
    return v % n;
  };
}

export function deckFromSeed(seedHex) {
  const rand = makeRng(seedHex);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = rand(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
