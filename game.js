// Ultra Set game rules. No browser or network code here, so it can be
// tested on its own with `node test/game.test.js`.
(function (root) {
  'use strict';

  const FEATURES = {
    color: ['red', 'green', 'purple'],
    shape: ['diamond', 'squiggle', 'oval'],
    number: [1, 2, 3],
    shading: ['solid', 'striped', 'hollow'],
    letter: ['S', 'E', 'T'],
  };
  const FEATURE_NAMES = Object.keys(FEATURES);
  const DECK_SIZE = 243; // 3^5
  const BOARD_SIZE = 12;

  // A card is a number 0..242; each base-3 digit is one feature.
  function cardFeatures(id) {
    const values = [];
    for (let i = 0; i < FEATURE_NAMES.length; i++) {
      values.push(id % 3);
      id = Math.floor(id / 3);
    }
    return values;
  }

  function describeCard(id) {
    const v = cardFeatures(id);
    const card = {};
    FEATURE_NAMES.forEach((name, i) => { card[name] = FEATURES[name][v[i]]; });
    return card;
  }

  // Each feature must be all the same or all different. With three
  // options per feature, that is exactly when the values sum to 0 mod 3.
  function isSet(a, b, c) {
    if (a === b || b === c || a === c) return false;
    const fa = cardFeatures(a), fb = cardFeatures(b), fc = cardFeatures(c);
    for (let i = 0; i < fa.length; i++) {
      if ((fa[i] + fb[i] + fc[i]) % 3 !== 0) return false;
    }
    return true;
  }

  function findSets(board) {
    const sets = [];
    for (let i = 0; i < board.length; i++)
      for (let j = i + 1; j < board.length; j++)
        for (let k = j + 1; k < board.length; k++)
          if (isSet(board[i], board[j], board[k])) sets.push([board[i], board[j], board[k]]);
    return sets;
  }

  function shuffledDeck() {
    const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function createState() {
    return {
      started: false,
      over: false,
      deck: [],
      board: [],
      players: {}, // clientId -> { name, score, online }
      votes: [],   // clientIds who want another row
      lastSet: null, // { by, cards }
      message: '',
      version: 0,
    };
  }

  function playerName(state, cid) {
    return (state.players[cid] && state.players[cid].name) || 'Someone';
  }

  function onlinePlayers(state) {
    return Object.keys(state.players).filter((cid) => state.players[cid].online);
  }

  function deal(state) {
    state.deck = shuffledDeck();
    state.board = state.deck.splice(0, BOARD_SIZE);
    state.votes = [];
    state.lastSet = null;
    state.over = false;
    state.started = true;
    Object.values(state.players).forEach((p) => { p.score = 0; });
  }

  function checkOver(state) {
    if (state.started && state.deck.length === 0 && findSets(state.board).length === 0) {
      state.over = true;
      state.votes = [];
    }
  }

  // Everyone online has asked for a row: deal three more cards.
  function maybeAddRow(state) {
    const online = onlinePlayers(state);
    if (online.length === 0 || !online.every((cid) => state.votes.includes(cid))) return false;
    state.votes = [];
    if (state.deck.length === 0) return false;
    state.board.push(...state.deck.splice(0, 3));
    state.message = 'Everyone agreed, so another row was added.';
    checkOver(state);
    return true;
  }

  // Apply one player's action. Returns { ok, error } where error is a
  // message meant only for the player who acted.
  function applyAction(state, cid, action) {
    const result = { ok: true, error: null };
    switch (action.type) {
      case 'join': {
        const name = String(action.name || '').trim().slice(0, 24) || 'Player';
        const existing = state.players[cid];
        state.players[cid] = { name, score: existing ? existing.score : 0, online: true };
        if (!existing) state.message = name + ' joined.';
        else if (!existing.online) state.message = name + ' is back.';
        maybeAddRow(state);
        break;
      }
      case 'leave': {
        if (state.players[cid]) {
          state.players[cid].online = false;
          state.votes = state.votes.filter((v) => v !== cid);
          state.message = playerName(state, cid) + ' disconnected.';
          maybeAddRow(state);
        }
        break;
      }
      case 'deal': {
        deal(state);
        state.message = playerName(state, cid) + ' dealt a new game.';
        checkOver(state);
        break;
      }
      case 'claim': {
        const cards = (action.cards || []).map(Number);
        if (!state.started || state.over) return { ok: false, error: 'The game is not running.' };
        if (cards.length !== 3 || !cards.every((c) => state.board.includes(c))) {
          return { ok: false, error: 'Too slow! Those cards were already taken.' };
        }
        if (!isSet(cards[0], cards[1], cards[2])) {
          return { ok: false, error: 'Not a set: ' + whyNotSet(cards) };
        }
        if (state.board.length > BOARD_SIZE || state.deck.length === 0) {
          // Extra rows are not refilled; the board shrinks back down.
          state.board = state.board.filter((c) => !cards.includes(c));
        } else {
          state.board = state.board.map((c) => (cards.includes(c) ? state.deck.shift() : c));
        }
        state.players[cid].score += 1;
        state.lastSet = { by: cid, cards };
        state.votes = [];
        state.message = playerName(state, cid) + ' found a set!';
        checkOver(state);
        break;
      }
      case 'vote': {
        if (!state.started || state.over) return { ok: false, error: null };
        if (state.votes.includes(cid)) {
          state.votes = state.votes.filter((v) => v !== cid);
        } else {
          state.votes.push(cid);
          if (!maybeAddRow(state)) state.message = playerName(state, cid) + ' wants another row.';
        }
        break;
      }
      default:
        return { ok: false, error: 'Unknown action.' };
    }
    state.version += 1;
    return result;
  }

  // Explain which features break the set, e.g. "color (two red, one green)".
  function whyNotSet(cards) {
    const fs = cards.map(cardFeatures);
    const bad = [];
    FEATURE_NAMES.forEach((name, i) => {
      if ((fs[0][i] + fs[1][i] + fs[2][i]) % 3 !== 0) bad.push(name === 'letter' ? 'corner letter' : name);
    });
    return bad.join(', ') + (bad.length === 1 ? ' is' : ' are') + ' two-and-one.';
  }

  const api = {
    FEATURES, FEATURE_NAMES, DECK_SIZE, BOARD_SIZE,
    cardFeatures, describeCard, isSet, findSets, createState, applyAction, onlinePlayers,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UltraSet = api;
})(this);
