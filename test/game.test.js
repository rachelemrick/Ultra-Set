// Run with: node test/game.test.js
const assert = require('assert');
const G = require('../game.js');

// Every pair of cards completes to exactly one set.
for (let a = 0; a < G.DECK_SIZE; a += 7) {
  for (let b = a + 1; b < G.DECK_SIZE; b += 11) {
    let count = 0;
    for (let c = 0; c < G.DECK_SIZE; c++) if (G.isSet(a, b, c)) count++;
    assert.strictEqual(count, 1, `pair ${a},${b}`);
  }
}
assert.strictEqual(new Set(Array.from({ length: 243 }, (_, i) => JSON.stringify(G.describeCard(i)))).size, 243);

// Play whole games with two simulated players.
for (let game = 0; game < 50; game++) {
  const s = G.createState();
  G.applyAction(s, 'a', { type: 'join', name: 'Rachel' });
  G.applyAction(s, 'b', { type: 'join', name: 'Friend' });
  G.applyAction(s, 'a', { type: 'deal' });
  assert.strictEqual(s.board.length, 12);
  assert.strictEqual(s.deck.length, 231);
  let turns = 0;
  while (!s.over && turns++ < 1000) {
    const sets = G.findSets(s.board);
    if (sets.length) {
      const who = turns % 2 ? 'a' : 'b';
      const before = s.board.length;
      assert.ok(G.applyAction(s, who, { type: 'claim', cards: sets[0] }).ok);
      assert.ok(s.board.length === before || s.board.length === before - 3);
      // A second claim of the same cards fails.
      assert.ok(!G.applyAction(s, 'b', { type: 'claim', cards: sets[0] }).ok);
    } else {
      G.applyAction(s, 'a', { type: 'vote' });
      assert.ok(s.votes.includes('a'), 'one vote is not enough');
      G.applyAction(s, 'b', { type: 'vote' });
      assert.strictEqual(s.votes.length, 0);
    }
  }
  assert.ok(s.over, 'game ends: ' + JSON.stringify({turns, deck: s.deck.length, board: s.board.length, votes: s.votes, msg: s.message}));
  assert.strictEqual(s.deck.length, 0);
  const total = s.players.a.score + s.players.b.score;
  const seen = new Set(s.board);
  assert.strictEqual(total * 3 + s.board.length, 243);
  assert.strictEqual(seen.size, s.board.length);
}

// A wrong guess explains itself.
const s = G.createState();
G.applyAction(s, 'a', { type: 'join', name: 'R' });
G.applyAction(s, 'a', { type: 'deal' });
s.board = [0, 1, 3, ...s.board.slice(3)];
const r = G.applyAction(s, 'a', { type: 'claim', cards: [0, 1, 3] });
assert.ok(!r.ok && /color, shape/.test(r.error), r.error);

// A player leaving lets the remaining votes count.
const t = G.createState();
G.applyAction(t, 'a', { type: 'join', name: 'R' });
G.applyAction(t, 'b', { type: 'join', name: 'F' });
G.applyAction(t, 'a', { type: 'deal' });
G.applyAction(t, 'a', { type: 'vote' });
G.applyAction(t, 'b', { type: 'leave' });
assert.strictEqual(t.board.length, 15);

// The host picks how many cards start on the table; the board shrinks back to it.
for (const size of G.START_SIZES) {
  const u = G.createState();
  G.applyAction(u, 'h', { type: 'join', name: 'Host' });
  G.applyAction(u, 'g', { type: 'join', name: 'Guest' });
  assert.ok(!G.applyAction(u, 'g', { type: 'settings', startCards: 21 }).ok, 'guests cannot change settings');
  assert.ok(G.applyAction(u, 'h', { type: 'settings', startCards: size }).ok);
  G.applyAction(u, 'h', { type: 'deal' });
  assert.strictEqual(u.board.length, size);
  G.applyAction(u, 'h', { type: 'vote' }); G.applyAction(u, 'g', { type: 'vote' });
  if (!u.over) assert.strictEqual(u.board.length, size + 3);
  let guard = 0;
  while (!u.over && guard++ < 500) {
    const sets = G.findSets(u.board);
    if (!sets.length) { G.applyAction(u, 'h', { type: 'vote' }); G.applyAction(u, 'g', { type: 'vote' }); continue; }
    const before = u.board.length;
    G.applyAction(u, 'h', { type: 'claim', cards: sets[0] });
    if (u.deck.length) assert.ok(u.board.length >= size && u.board.length <= Math.max(before, size));
  }
  assert.ok(u.over);
  assert.strictEqual(u.players.h.score * 3 + u.board.length, 243);
}

// Hints need everyone's agreement, are off unless the host turns them on,
// and show one card of a set, then a second card of the same set.
{
  const h = G.createState();
  G.applyAction(h, 'h', { type: 'join', name: 'Host' });
  G.applyAction(h, 'g', { type: 'join', name: 'Guest' });
  G.applyAction(h, 'h', { type: 'deal' });
  assert.ok(h.settings.hints, 'hints on by default');
  G.applyAction(h, 'h', { type: 'settings', hints: false });
  assert.ok(!G.applyAction(h, 'h', { type: 'hint' }).ok, 'no hints once turned off');
  G.applyAction(h, 'h', { type: 'settings', hints: true });
  let guard = 0;
  while (!G.findSets(h.board).length && guard++ < 20) { G.applyAction(h, 'h', { type: 'vote' }); G.applyAction(h, 'g', { type: 'vote' }); }
  G.applyAction(h, 'h', { type: 'hint' });
  assert.strictEqual(h.hint, null, 'one vote is not enough');
  G.applyAction(h, 'g', { type: 'hint' });
  assert.strictEqual(h.hint.shown, 1);
  assert.ok(G.isSet(...h.hint.set) && h.hint.set.every((c) => h.board.includes(c)));
  G.applyAction(h, 'h', { type: 'hint' }); G.applyAction(h, 'g', { type: 'hint' });
  assert.strictEqual(h.hint.shown, 2);
  assert.ok(!G.applyAction(h, 'h', { type: 'hint' }).ok, 'no third card');
  G.applyAction(h, 'g', { type: 'claim', cards: h.hint.set });
  assert.strictEqual(h.hint, null, 'hint clears when the board changes');

  // With no set on the table, the hint says so.
  h.board = [0, 1, 3, 4];
  G.applyAction(h, 'h', { type: 'hint' }); G.applyAction(h, 'g', { type: 'hint' });
  assert.ok(h.hint.none, JSON.stringify(h.hint));
}

console.log('All game tests passed.');
