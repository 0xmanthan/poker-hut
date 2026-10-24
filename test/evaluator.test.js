import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, describe, category, bestFive } from '../engine/evaluator.js';
import { deckFromSeed, commitment, newSeed } from '../engine/deck.js';
import { cs } from './helpers.js';

const ev = (s) => evaluate(cs(s));

test('names hands correctly', () => {
  assert.equal(describe(ev('As Ks Qs Js Ts 2d 3c')), 'Royal flush');
  assert.equal(describe(ev('5h 4h 3h 2h Ah Kd Kc')), 'Straight flush, Five high');
  assert.equal(describe(ev('9c 9d 9h 9s 2d 3c Ks')), 'Four Nines');
  assert.equal(describe(ev('9c 9d 9h 2s 2d 3c 3s')), 'Full house, Nines full of Threes');
  assert.equal(describe(ev('9c 9d 9h 2s 2d 2c Ks')), 'Full house, Nines full of Twos');
  assert.equal(describe(ev('Ac 9c 7c 4c 2c Kd Qs')), 'Flush, Ace high');
  assert.equal(describe(ev('Ac 2d 3h 4s 5c Kd Qs')), 'Straight, Five high');
  assert.equal(describe(ev('Tc Jd Qh Ks Ac 2d 3s')), 'Straight, Ace high');
  assert.equal(describe(ev('7c 7d 7h Ks 2c 3d 9s')), 'Three Sevens');
  assert.equal(describe(ev('7c 7d 3h 3s 2c 2d 9s')), 'Two pair, Sevens and Threes');
  assert.equal(describe(ev('7c 7d 3h Ks 2c Jd 9s')), 'Pair of Sevens');
  assert.equal(describe(ev('7c 5d 3h Ks 2c Jd 9s')), 'King high');
});

test('compares hands correctly', () => {
  assert.ok(ev('As Ad Kc Kd 2s 3c 4h') > ev('As Ad Qc Qd Js Tc 9h'), 'higher second pair wins');
  assert.ok(ev('7c 7d 3h 3s 2c 2d Ks') > ev('7c 7d 3h 3s 2c 2d Qs'), 'kicker from third pair counts');
  assert.equal(ev('7c 7d 3h 3s Ac 2d 4s'), ev('7h 7s 3c 3d Ad 2s 4h'), 'identical hands tie');
  assert.ok(ev('2c 3c 4c 5c 7c 8d 9d') > ev('Ac Kd Qh Js Tc 2d 3s'), 'flush beats straight');
  assert.ok(ev('6c 2d 3h 4s 5c Kd Qs') > ev('Ac 2d 3h 4s 5c Kd Qs'), 'six-high straight beats the wheel');
  assert.ok(ev('Ac Ad Ah 2s 2d 3c 4s') > ev('Kc Kd Kh Qs Qd Jc Js'), 'aces full beats kings full');
  assert.ok(ev('Ac Kc 9h 9s 2d 3c 4s') > ev('Qc Jc 9d 9c 2s 3d 4h'), 'kicker decides a pair');
  assert.ok(ev('Ac Ad As Ah 2d 3c Ks') > ev('Ac Ad As Ah 2d 3c Qs'), 'quads kicker');
});

test('exhaustive 5-card frequencies match combinatorics exactly', () => {
  // the textbook counts over all C(52,5) = 2,598,960 hands
  const expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
  const counts = new Array(9).fill(0);
  const h = [0, 0, 0, 0, 0];
  for (h[0] = 0; h[0] < 52; h[0]++)
    for (h[1] = h[0] + 1; h[1] < 52; h[1]++)
      for (h[2] = h[1] + 1; h[2] < 52; h[2]++)
        for (h[3] = h[2] + 1; h[3] < 52; h[3]++)
          for (h[4] = h[3] + 1; h[4] < 52; h[4]++) counts[category(evaluate(h))]++;
  assert.deepEqual(counts, expected);
});

test('bestFive picks the winning cards', () => {
  const b = bestFive(cs('As Ks 2d Qs Js 3c Ts'));
  assert.equal(describe(b.score), 'Royal flush');
  assert.deepEqual(b.cards.sort(), cs('As Ks Qs Js Ts').sort());
});

test('deck from seed is a deterministic permutation with a matching commitment', () => {
  const seed = newSeed();
  const d1 = deckFromSeed(seed), d2 = deckFromSeed(seed);
  assert.deepEqual(d1, d2);
  assert.deepEqual([...d1].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i));
  assert.match(commitment(seed), /^[0-9a-f]{64}$/);
  assert.notDeepEqual(deckFromSeed(newSeed()), d1);
});

test('shuffle is uniform: every card lands in every position equally often', () => {
  const N = 20000;
  const pos = Array.from({ length: 52 }, () => new Array(52).fill(0));
  for (let i = 0; i < N; i++) deckFromSeed(newSeed()).forEach((card, p) => pos[card][p]++);
  // chi-square over 52x52 cells, df = 51*51 = 2601; mean 2601, sd ~72. Fail only beyond ~6 sd.
  const e = N / 52;
  let chi = 0;
  for (const row of pos) for (const o of row) chi += (o - e) ** 2 / e;
  assert.ok(chi < 2601 + 6 * 72 && chi > 2601 - 6 * 72, `chi-square ${chi.toFixed(0)}`);
});
