import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTable, stackedDeck, totalChips } from './helpers.js';
import { Table, buildPots } from '../engine/table.js';

const stack = (t, id) => t.players.get(id).stack;

test('heads-up: button posts small blind and acts first preflop, last postflop', () => {
  const { t, settle } = makeTable({ players: 2 });
  t.start('p0');
  settle();
  const h = t.hand;
  assert.equal(h.buttonSeat, 0);
  assert.equal(h.sbSeat, 0);
  assert.equal(h.bbSeat, 1);
  assert.equal(stack(t, 'p0'), 995);
  assert.equal(stack(t, 'p1'), 990);
  assert.equal(h.toAct, 'p0');
  t.act('p0', { type: 'call' });
  assert.equal(h.toAct, 'p1', 'big blind gets the option');
  t.act('p1', { type: 'check' });
  settle();
  assert.equal(h.street, 'flop');
  assert.equal(h.board.length, 3);
  assert.equal(h.toAct, 'p1', 'non-button acts first after the flop');
});

test('3-handed: blinds, action order, fold to big blind', () => {
  const { t, settle, finishHand } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  const h = t.hand;
  assert.deepEqual([h.buttonSeat, h.sbSeat, h.bbSeat], [0, 1, 2]);
  assert.deepEqual(h.order, [1, 2, 0], 'dealing starts left of the button');
  assert.equal(h.toAct, 'p0', 'under the gun acts first');
  t.act('p0', { type: 'fold' });
  t.act('p1', { type: 'fold' });
  assert.ok(h.over);
  assert.equal(stack(t, 'p2'), 1005);
  assert.equal(stack(t, 'p1'), 995);
  finishHand();
  assert.equal(totalChips(t), 3000);
});

test('button moves and the next hand starts on its own', () => {
  const { t, settle, flush } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  t.act('p0', { type: 'fold' });
  t.act('p1', { type: 'fold' });
  flush(2); // cleanup, then start next hand
  assert.equal(t.hand.no, 2);
  assert.equal(t.hand.buttonSeat, 1);
  assert.equal(t.hand.toAct, 'p1', 'button is UTG three-handed');
});

test('minimum raise is enforced and tracks the last raise size', () => {
  const { t, settle } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  assert.throws(() => t.act('p0', { type: 'raise', to: 15 }), /minimum is 20/);
  t.act('p0', { type: 'raise', to: 40 }); // raise of 30
  assert.equal(t.options('p1').minTo, 70);
  assert.throws(() => t.act('p1', { type: 'raise', to: 60 }), /minimum is 70/);
  t.act('p1', { type: 'raise', to: 70 });
  assert.equal(t.options('p2').minTo, 100);
  assert.throws(() => t.act('p2', { type: 'check' }), /call or fold/);
});

test('incomplete all-in raise does not reopen betting to players who already acted', () => {
  // p0 button, p1 SB, p2 BB. p2 is short.
  const { t, settle } = makeTable({ players: 3, stacks: [1000, 1000, 70] });
  t.start('p0');
  settle();
  t.act('p0', { type: 'call' });
  t.act('p1', { type: 'call' });
  t.act('p2', { type: 'check' });
  settle(); // flop: p1 first
  t.act('p1', { type: 'raise', to: 50 }); // bet 50
  t.act('p2', { type: 'allin' }); // 60 total: a raise of 10, less than 50
  assert.equal(t.hand.currentBet, 60);
  const o0 = t.options('p0');
  assert.equal(o0.canRaise, true, 'p0 has not acted this street, may raise');
  t.act('p0', { type: 'call' });
  const o1 = t.options('p1');
  assert.equal(o1.canRaise, false, 'p1 already acted; incomplete raise does not reopen');
  assert.equal(o1.toCall, 10);
  t.act('p1', { type: 'call' });
  settle();
  assert.equal(t.hand.street, 'turn');
});

test('full raise after action reopens betting', () => {
  const { t, settle } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  t.act('p0', { type: 'call' });
  t.act('p1', { type: 'raise', to: 30 });
  t.act('p2', { type: 'call' });
  assert.equal(t.hand.toAct, 'p0');
  assert.equal(t.options('p0').canRaise, true);
});

test('side pots: three all-ins with different stacks pay out correctly', () => {
  // dealing order is p1, p2, p0. p1 (100 chips) has the best hand, p2 (300) second, p0 (1000) worst.
  const deck = stackedDeck([['As', 'Ad'], ['Ks', 'Kd'], ['2c', '7h']], '3s 8d 9c Jh 4d');
  const { t, settle, finishHand } = makeTable({ players: 3, stacks: [1000, 100, 300], decks: [deck] });
  t.start('p0');
  settle();
  t.act('p0', { type: 'raise', to: 1000 });
  t.act('p1', { type: 'call' });
  t.act('p2', { type: 'call' });
  finishHand();
  // main pot 300 -> p1, side pot (200 + 200) = 400 -> p2, uncalled 700 back to p0
  assert.equal(stack(t, 'p1'), 300);
  assert.equal(stack(t, 'p2'), 400);
  assert.equal(stack(t, 'p0'), 700);
  assert.equal(totalChips(t), 1400);
  assert.equal(t.lastResult.winners.find((w) => w.uid === 'p1').hand, 'Pair of Aces');
});

test('split pot gives the odd chip to the first player left of the button', () => {
  // board plays for everyone: royal flush on board
  const deck = stackedDeck([['2c', '3d'], ['2d', '3c'], ['4h', '5h']], 'As Ks Qs Js Ts');
  const { t, settle, finishHand } = makeTable({ players: 3, decks: [deck], settings: { smallBlind: 5, bigBlind: 10 } });
  t.start('p0');
  settle();
  // p0 folds, p1 (SB) completes, p2 checks -> pot 20 + p0 nothing; make pot odd via a fold after a bet
  t.act('p0', { type: 'raise', to: 25 });
  t.act('p1', { type: 'call' });
  t.act('p2', { type: 'call' });
  settle();
  t.act('p1', { type: 'check' });
  t.act('p2', { type: 'check' });
  t.act('p0', { type: 'raise', to: 11 });
  t.act('p1', { type: 'call' });
  t.act('p2', { type: 'fold' });
  settle();
  t.act('p1', { type: 'check' });
  t.act('p0', { type: 'check' });
  settle();
  t.act('p1', { type: 'check' });
  t.act('p0', { type: 'check' });
  finishHand();
  // pot = 75 + 22 = 97, split between p0 and p1; p1 (SB) is first left of button -> 49
  assert.equal(stack(t, 'p1'), 1000 - 36 + 49);
  assert.equal(stack(t, 'p0'), 1000 - 36 + 48);
  assert.equal(totalChips(t), 3000);
});

test('all-in preflop runs out the board and reveals hands', () => {
  const { t, settle, finishHand } = makeTable({ players: 2 });
  t.start('p0');
  settle();
  t.act('p0', { type: 'allin' });
  t.act('p1', { type: 'call' });
  assert.equal(t.hand.toAct, null);
  assert.equal(t.hand.showAll, true);
  const v = t.viewFor('p1');
  assert.ok(v.seats[0].cards.every((x) => x !== null), 'opponent cards visible during all-in runout');
  finishHand();
  assert.equal(t.hand.board.length, 5);
  assert.equal(totalChips(t), 2000);
});

test("players never see each other's hole cards before showdown", () => {
  const { t, settle } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  const v = t.viewFor('p0');
  assert.ok(v.seats[0].cards.every((x) => Number.isInteger(x)));
  assert.deepEqual(v.seats[1].cards, [null, null]);
  assert.deepEqual(v.seats[2].cards, [null, null]);
  assert.equal(JSON.stringify(v).includes(t.hand.seed), false, 'seed is secret during the session');
  assert.equal(v.fairness.at(-1).seed, null);
});

test('buy-in during a hand waits until the hand ends', () => {
  const { t, settle, finishHand } = makeTable({ players: 2 });
  t.start('p0');
  settle();
  t.requestBuyIn('p1', 500);
  assert.equal(stack(t, 'p1'), 990);
  assert.equal(t.pendingOps.length, 1);
  t.act('p0', { type: 'fold' });
  finishHand();
  t.cleanupHand();
  assert.equal(stack(t, 'p1'), 1005 + 500);
  assert.equal(t.billSheet().rows.find((r) => r.uid === 'p1').boughtIn, 1500);
});

test('buy-ins need host approval unless auto-approve is on', () => {
  const { t } = makeTable({ players: 2, settings: { autoApproveBuyIns: false } });
  t.join({ id: 'p9', name: 'P9' });
  t.sit('p9', 5);
  assert.deepEqual(t.requestBuyIn('p9', 300), { approved: false });
  assert.equal(stack(t, 'p9'), 0);
  const req = t.requests.find((r) => r.uid === 'p9');
  assert.throws(() => t.resolveRequest('p9', req.id, true), /Only the host/);
  t.resolveRequest('p0', req.id, true);
  assert.equal(stack(t, 'p9'), 300);
});

test('bill sheet: transfers are loans, nets sum to zero, settlement balances', () => {
  const { t } = makeTable({ players: 3, settings: { tokenValue: 0.5 } });
  t.transfer('p0', 'p0', 'p1', 200); // p0 lends p1 200
  assert.equal(stack(t, 'p0'), 800);
  assert.equal(stack(t, 'p1'), 1200);
  assert.throws(() => t.transfer('p1', 'p2', 'p1', 10), /Only the host/);
  t.players.get('p1').stack -= 700; // simulate p1 losing 700 to p2
  t.players.get('p2').stack += 700;
  const { rows, payments } = t.billSheet();
  const byId = Object.fromEntries(rows.map((r) => [r.uid, r]));
  assert.equal(byId.p0.net, 0, 'lent chips are owed back');
  assert.equal(byId.p1.net, -700);
  assert.equal(byId.p2.net, 700);
  assert.equal(byId.p2.money, 350);
  assert.equal(rows.reduce((a, r) => a + r.net, 0), 0);
  assert.deepEqual(payments.map((p) => [p.from, p.to, p.chips, p.money]), [['p1', 'p2', 700, 350]]);
});

test('cannot transfer more chips than you have', () => {
  const { t } = makeTable({ players: 2 });
  assert.throws(() => t.transfer('p0', 'p0', 'p1', 1001), /only has 1000/);
});

test('restart mid-hand voids the hand and restores stacks and ledger', () => {
  const { t, settle } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  t.act('p0', { type: 'raise', to: 100 });
  const saved = JSON.parse(JSON.stringify(t.toJSON()));
  const r = Table.fromJSON(saved, { schedule: () => null, clear: () => {} });
  assert.equal(r.status, 'running');
  assert.equal(r.hand, null);
  assert.deepEqual([...r.players.values()].map((p) => p.stack), [1000, 1000, 1000]);
  assert.equal(r.ledger.entries.length, 3);
  assert.equal(r.history.length, 0);
});

test('standing up mid-hand folds and leaves after the hand', () => {
  const { t, settle, finishHand } = makeTable({ players: 3 });
  t.start('p0');
  settle();
  t.standUp('p2'); // BB, not their turn
  assert.equal(t.hand.ps.get('p2').folded, true);
  assert.equal(t.players.get('p2').seat, 2, 'seat kept until hand ends');
  t.act('p0', { type: 'fold' });
  finishHand();
  t.cleanupHand();
  assert.equal(t.players.get('p2').seat, null);
  assert.equal(totalChips(t), 3000);
});

test('buildPots handles folded over-contributors', () => {
  const pots = buildPots([
    { uid: 'a', total: 100, folded: false },
    { uid: 'b', total: 30, folded: false },
    { uid: 'c', total: 60, folded: true },
  ]);
  assert.deepEqual(pots, [{ amount: 90, eligible: ['a', 'b'] }, { amount: 100, eligible: ['a'] }]);
});

test('fuzz: 3000 random hands never create, lose or go below zero chips', () => {
  for (const n of [2, 3, 6, 9]) {
    const stacks = Array.from({ length: n }, (_, i) => 200 + i * 137);
    const { t, queue } = makeTable({ players: n, stacks });
    t.start('p0');
    let rnd = 12345 + n;
    const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
    let hands = 0, steps = 0;
    while (hands < 750 && steps < 200000) {
      steps++;
      if (t.hand && !t.hand.over && t.hand.toAct) {
        const uid = t.hand.toAct;
        const o = t.options(uid);
        const r = rand();
        if (r < 0.15) t.act(uid, { type: 'fold' });
        else if (r < 0.6) t.act(uid, { type: o.canCheck ? 'check' : 'call' });
        else if (r < 0.9 && o.canRaise) t.act(uid, { type: 'raise', to: o.minTo + Math.floor(rand() * (o.maxTo - o.minTo + 1)) });
        else if (o.canRaise) t.act(uid, { type: 'allin' });
        else t.act(uid, { type: 'call' });
      } else if (queue.length) {
        const h = queue.shift();
        if (!h.dead) { const before = t.handNo; h.fn(); if (t.handNo !== before) hands++; }
      } else {
        // everyone but one is broke: rebuy the busted players
        for (const p of t.players.values()) if (p.stack === 0 && p.seat !== null) t.requestBuyIn(p.id, 300);
      }
      assert.equal(totalChips(t), t.billSheet().rows.reduce((a, r) => a + r.boughtIn, 0), 'chips in play equal chips bought');
      for (const p of t.players.values()) assert.ok(p.stack >= 0);
      if (t.hand?.over) {
        const sheet = t.billSheet();
        assert.equal(sheet.rows.reduce((a, r) => a + r.net, 0), 0, 'bill sheet nets sum to zero');
      }
    }
    assert.ok(hands >= 750, `played ${hands} hands with ${n} players`);
  }
});

test('ending mid-hand finishes the hand first, then reveals seeds', () => {
  const { t, settle, finishHand } = makeTable({ players: 2 });
  t.start('p0');
  settle();
  t.endSession('p0');
  assert.equal(t.status, 'paused');
  assert.deepEqual(t.revealedHistory(), []);
  t.act('p0', { type: 'fold' });
  finishHand();
  t.cleanupHand();
  assert.equal(t.status, 'ended');
  assert.equal(t.revealedHistory().length, 1);
  assert.match(t.revealedHistory()[0].seed, /^[0-9a-f]{64}$/);
  assert.throws(() => t.sit('p0', 4), /ended/);
});

test('host can free a seat; non-host cannot', () => {
  const { t } = makeTable({ players: 3 });
  assert.throws(() => t.removeFromSeat('p1', 'p2'), /Only the host/);
  t.removeFromSeat('p0', 'p2');
  assert.equal(t.players.get('p2').seat, null);
  assert.equal(t.players.get('p2').stack, 1000);
});
