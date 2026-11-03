import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, describe, categoryNames } from '../engine/evaluator.js';
import { deckFromSeed, newSeed } from '../engine/deck.js';
import { cs, c, makeTable, totalChips } from './helpers.js';

const SHORT = { short: true };
const TRITON = { short: true, tripsBeatStraight: true };
const ev = (s, rules) => evaluate(cs(s), rules);

test('short deck: the deck is 36 cards, sixes to aces, each once', () => {
  for (let i = 0; i < 50; i++) {
    const deck = deckFromSeed(newSeed(), 'shortdeck');
    assert.equal(deck.length, 36);
    assert.equal(new Set(deck).size, 36);
    assert.ok(deck.every((x) => x >= 16 && x <= 51), 'no twos to fives');
  }
  const seed = newSeed();
  assert.deepEqual([...deckFromSeed(seed)].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i), "hold'em deck unchanged");
});

test('short deck: flush beats a full house (Hold\'em is the other way round)', () => {
  const flush = 'Ac 9c 7c 6c Jc Kd Qs';
  const boat = '9d 9h 9s Kc Kh 6d 7s';
  assert.ok(ev(flush, SHORT) > ev(boat, SHORT));
  assert.ok(ev(flush) < ev(boat));
  assert.equal(describe(ev(flush, SHORT), SHORT), 'Flush, Ace high');
  assert.equal(describe(ev(boat, SHORT), SHORT), 'Full house, Nines full of Kings');
});

test('short deck: A-6-7-8-9 is the lowest straight; not a straight in Hold\'em', () => {
  const wheel = 'Ac 6d 7h 8s 9c Kd Qs';
  assert.equal(describe(ev(wheel, SHORT), SHORT), 'Straight, Nine high');
  assert.ok(ev('6c 7d 8h 9s Tc Kd Qs', SHORT) > ev(wheel, SHORT), 'six-to-ten beats the short wheel');
  assert.equal(describe(ev(wheel)), 'Ace high');
  assert.equal(describe(ev('Ac 6c 7c 8c 9c Kd Qs', SHORT), SHORT), 'Straight flush, Nine high');
});

test('short deck: straight beats trips by default, trips beat a straight on Triton rules', () => {
  const straight = '6c 7d 8h 9s Tc Kd Qs';
  const trips = 'Jc Jd Jh 6s 8c Kd Qs';
  assert.ok(ev(straight, SHORT) > ev(trips, SHORT));
  assert.ok(ev(trips, TRITON) > ev(straight, TRITON));
  // both in one hand: the rule picks which one you hold
  const both = 'Tc Td Th 6s 7c 8d 9s';
  assert.equal(describe(ev(both, SHORT), SHORT), 'Straight, Ten high');
  assert.equal(describe(ev(both, TRITON), TRITON), 'Three Tens');
});

test('short deck: exact counts of all 376,992 five-card hands', () => {
  const counts = new Array(9).fill(0);
  const cards = Array.from({ length: 36 }, (_, i) => i + 16);
  const hand = new Array(5);
  for (let a = 0; a < 36; a++) for (let b = a + 1; b < 36; b++) for (let d = b + 1; d < 36; d++) for (let e = d + 1; e < 36; e++) for (let f = e + 1; f < 36; f++) {
    hand[0] = cards[a]; hand[1] = cards[b]; hand[2] = cards[d]; hand[3] = cards[e]; hand[4] = cards[f];
    counts[evaluate(hand, SHORT) >> 20]++;
  }
  const byName = Object.fromEntries(categoryNames(SHORT).map((n, i) => [n, counts[i]]));
  assert.deepEqual(byName, {
    'High card': 122400, Pair: 193536, 'Two pair': 36288, 'Three of a kind': 16128, Straight: 6120,
    'Full house': 1728, Flush: 480, 'Four of a kind': 288, 'Straight flush': 24,
  });
  assert.deepEqual(categoryNames(SHORT).slice(4, 7), ['Straight', 'Full house', 'Flush']);
  assert.deepEqual(categoryNames(TRITON).slice(3, 5), ['Straight', 'Three of a kind']);
});

// deals `holes` then the board, like stackedDeck, but from a 36-card deck
function shortStack(holes, board) {
  const order = [];
  for (let r = 0; r < 2; r++) for (const h of holes) order.push(c(h[r]));
  const b = board.split(' ').map(c);
  const used = new Set([...order, ...b]);
  const rest = Array.from({ length: 36 }, (_, i) => i + 16).filter((x) => !used.has(x));
  return [...order, rest.shift(), b[0], b[1], b[2], rest.shift(), b[3], rest.shift(), b[4], ...rest];
}

test('short deck table: deals from 36 cards and pays the flush over the full house', () => {
  // live shuffle: every dealt card is a six or higher
  const live = makeTable({ players: 3, settings: { variant: 'shortdeck' } });
  live.t.start('p0');
  live.settle();
  assert.equal(live.t.hand.variant, 'shortdeck');
  for (const s of live.t.hand.ps.values()) assert.ok(s.cards.every((x) => x >= 16));

  // heads-up, all in preflop (P1 is dealt first): P1 makes a full house, P0 a flush
  const deck = shortStack([['9d', 'Kd'], ['Ac', 'Jc']], '9h 9s Kc 7c 6c');
  const { t, settle, finishHand } = makeTable({ players: 2, settings: { variant: 'shortdeck', runItTwice: false }, decks: [deck] });
  t.start('p0');
  settle();
  const before = totalChips(t);
  t.act(t.hand.toAct, { type: 'allin' });
  settle();
  t.act(t.hand.toAct, { type: 'call' });
  finishHand();
  const result = t.hand.result;
  assert.equal(result.winners.length, 1);
  assert.equal(result.winners[0].uid, 'p0', 'flush wins');
  assert.match(result.shown.p1.hand, /Full house/);
  assert.match(result.winners[0].hand, /Flush/);
  assert.equal(totalChips(t), before);
  assert.equal(t.history.at(-1).variant, 'shortdeck');
});

test('switching variant applies from the next hand', () => {
  const { t, settle, finishHand } = makeTable({ players: 2 });
  t.start('p0');
  settle();
  t.updateSettings('p0', { variant: 'shortdeck' });
  assert.equal(t.hand.variant, 'nlhe', 'current hand keeps its deck');
  t.act(t.hand.toAct, { type: 'fold' });
  finishHand();
  for (let i = 0; i < 5 && (!t.hand || t.hand.over); i++) settle();
  assert.equal(t.hand.variant, 'shortdeck');
});

test('sitting down with a buy-in seats you and asks for the chips in one step', () => {
  const { t } = makeTable({ players: 2, settings: { autoApproveBuyIns: false } });
  t.join({ id: 'p7', name: 'P7' });
  t.sit('p7', 5, 800);
  assert.equal(t.players.get('p7').seat, 5);
  const mine = t.requests.filter((r) => r.uid === 'p7');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].amount, 800);
  assert.throws(() => t.sit('p7', 6, 1.5), /whole number/);
  t.resolveRequest('p0', mine[0].id, true);
  assert.equal(t.players.get('p7').stack, 800);
});

test('the host theme is a table setting', () => {
  const { t } = makeTable({ players: 2 });
  assert.equal(t.settings.theme, 'heirloom');
  t.updateSettings('p0', { theme: 'claude' });
  assert.equal(t.viewFor('p1').settings.theme, 'claude');
  t.updateSettings('p0', { theme: 'pop' }); // retired theme falls back
  assert.equal(t.settings.theme, 'heirloom');
  assert.throws(() => t.updateSettings('p1', { theme: 'midnight' }), /host/);
});
