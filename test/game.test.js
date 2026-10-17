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

console.log('All game tests passed.');
