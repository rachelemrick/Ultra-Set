// Page wiring and two-player networking.
//
// The person who starts a game is the host: their browser keeps the real
// game state and applies everyone's moves. Friends send their moves to the
// host and get the updated state back, through the public relays in
// relay.js. No server of our own is needed, so the whole thing can live
// on GitHub Pages.
(function () {
  'use strict';

  const G = window.UltraSet;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const joinCode = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
  };

  // A per-browser id, so a player keeps their score if they reconnect.
  let clientId = storage.get('ultra-set-client');
  if (!clientId) {
    clientId = Math.random().toString(36).slice(2, 10);
    storage.set('ultra-set-client', clientId);
  }

  // Lets tests use local relays, e.g. ?relay=ws://127.0.0.1:8888,ws://127.0.0.1:8889
  const brokers = params.get('relay') ? params.get('relay').split(',') : (window.UltraSetRelay ? window.UltraSetRelay.DEFAULT_BROKERS : []);
  const HEARTBEAT_MS = 5000;
  const GUEST_TIMEOUT_MS = 20000;  // host marks a silent guest offline after this
  const HOST_TIMEOUT_MS = 20000;   // guest says the host is away after this

  let isHost = false;
  let relay = null;
  const lastSeen = new Map();     // host: clientId -> last time we heard from them
  const seenIds = [];             // recent message ids, to drop repeats from other relays
  let hostHeardAt = 0;            // guest: last live message from the host
  let state = null;
  let roomCode = null;
  let selected = [];
  let lastBoard = [];
  let myName = storage.get('ultra-set-name') || '';
  let pendingClaim = null;        // three cards sent to the host, awaiting an answer

  // ---------- Welcome screen ----------

  $('name-input').value = myName;
  if (joinCode) {
    $('start-button').textContent = 'Join game';
    $('welcome-intro').textContent = "You've been invited to a game of Ultra Set. Enter your name to join.";
  } else if (storage.get('ultra-set-host')) {
    $('resume-button').hidden = false;
  }
  $('welcome').hidden = false;
  if (!joinCode) $('name-input').focus();

  $('name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    myName = $('name-input').value.trim();
    if (!myName) return;
    storage.set('ultra-set-name', myName);
    if (joinCode) startGuest(joinCode);
    else startHost(null);
  });

  $('resume-button').addEventListener('click', () => {
    const saved = storage.get('ultra-set-host');
    myName = $('name-input').value.trim() || myName || 'Player';
    storage.set('ultra-set-name', myName);
    startHost(saved);
  });

  function showGame() {
    $('welcome').hidden = true;
    $('game').hidden = false;
  }

  // ---------- Host ----------

  function newCode() {
    const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += letters[Math.floor(Math.random() * letters.length)];
    return code;
  }

  function startHost(saved) {
    isHost = true;
    showGame();
    if (saved && saved.state) {
      state = G.upgrade(saved.state);
      roomCode = saved.code;
      Object.values(state.players).forEach((p) => { p.online = false; });
    } else {
      state = G.createState();
      roomCode = newCode();
    }
    G.applyAction(state, clientId, { type: 'join', name: myName });
    saveHost();
    render();
    openHostRoom();
  }

  function topic(name) {
    return 'ultra-set/v1/' + roomCode + '/' + name;
  }

  function newId() {
    return Math.random().toString(36).slice(2, 12);
  }

  // True the first time we see this id; repeats come from the other relays.
  function firstSighting(id) {
    if (!id) return true;
    if (seenIds.includes(id)) return false;
    seenIds.push(id);
    if (seenIds.length > 300) seenIds.shift();
    return true;
  }

  function openRelay(onStatus) {
    if (!window.mqtt || !window.UltraSetRelay) {
      setConnection('This copy is for playing on your own; online play needs the full site.');
      return null;
    }
    return window.UltraSetRelay.createRelay(brokers, onStatus);
  }

  function openHostRoom() {
    setConnection('Setting up your game room…');
    let everConnected = false;
    relay = openRelay((count) => {
      if (count > 0) {
        if (!everConnected) publishState();
        everConnected = true;
        $('invite-link').value = location.origin + location.pathname + '?join=' + roomCode;
        $('invite').hidden = false;
        setConnection('Your game room is open. You can also play on your own.');
      } else {
        setConnection(everConnected
          ? 'Lost the connection to the online service. Reconnecting…'
          : 'Trying to reach the online service…');
      }
    });
    if (!relay) return;
    setTimeout(() => {
      if (!everConnected) setConnection("Can't reach the online service from this network. You can still play on your own; it keeps trying in the background.");
    }, 12000);
    relay.subscribe(topic('action'), onGuestMessage);
    setInterval(hostHeartbeat, HEARTBEAT_MS);
  }

  function onGuestMessage(msg, info) {
    if (info.retained || !msg || !msg.action || !msg.clientId || !firstSighting(msg.id)) return;
    const cid = String(msg.clientId);
    if (cid === clientId) return;
    lastSeen.set(cid, Date.now());
    let action = msg.action;
    if (action.type === 'ping') {
      // A ping from someone the game doesn't have online yet counts as joining.
      const p = state.players[cid];
      if (p && p.online) return;
      action = { type: 'join', name: msg.name };
    }
    const result = G.applyAction(state, cid, action);
    if (!result.ok && result.error) relay.publish(topic('to/' + cid), { id: newId(), error: result.error });
    if (result.ok) afterHostChange();
  }

  // Resend the state so guests know the host is still here, and notice
  // guests who have gone quiet.
  function hostHeartbeat() {
    const now = Date.now();
    let changed = false;
    Object.keys(state.players).forEach((cid) => {
      if (cid === clientId || !state.players[cid].online) return;
      if (now - (lastSeen.get(cid) || 0) > GUEST_TIMEOUT_MS) {
        G.applyAction(state, cid, { type: 'leave' });
        changed = true;
      }
    });
    if (changed) afterHostChange();
    else publishState();
  }

  function publishState() {
    if (relay) relay.publish(topic('state'), { id: newId(), state }, { retain: true });
  }

  function afterHostChange() {
    saveHost();
    publishState();
    render();
  }

  function saveHost() {
    storage.set('ultra-set-host', { code: roomCode, state });
  }

  // ---------- Guest ----------

  function startGuest(code) {
    isHost = false;
    roomCode = code;
    showGame();
    setConnection('Connecting to the game…');
    render();
    relay = openRelay((count) => {
      if (count === 0) setConnection('Trying to reach the online service…');
      else if (!hostHeardAt) setConnection('Looking for the game…');
      if (count > 0) ping();
    });
    if (!relay) return;
    relay.subscribe(topic('state'), onHostState);
    relay.subscribe(topic('to/' + clientId), (msg, info) => {
      if (!info.retained && msg.error && firstSighting(msg.id)) showError(msg.error);
    });
    setInterval(() => { ping(); checkHost(); }, HEARTBEAT_MS);
    setTimeout(() => {
      if (!relay.connectedCount()) {
        setConnection("Can't reach the online service from this network. It keeps trying; a different Wi-Fi or your phone's data may help.");
      } else if (!hostHeardAt) {
        setConnection("Can't find that game yet. Check that the host has the game open; it keeps looking.");
      }
    }, 12000);
    addEventListener('pagehide', () => sendAction({ type: 'leave' }));
  }

  function onHostState(msg, info) {
    if (!msg || !msg.state || !firstSighting(msg.id)) return;
    // A saved copy from the relay shows the table right away, but only a
    // live message proves the host is here.
    if (!info.retained) {
      const wasAway = !hostHeardAt || Date.now() - hostHeardAt > HOST_TIMEOUT_MS;
      hostHeardAt = Date.now();
      if (wasAway) setConnection('Connected.');
    }
    if (state && msg.state.version < state.version) return;
    state = G.upgrade(msg.state);
    if (!info.retained && !(state.players[clientId] && state.players[clientId].online)) ping();
    render();
  }

  function checkHost() {
    if (hostHeardAt && Date.now() - hostHeardAt > HOST_TIMEOUT_MS) {
      pendingClaim = null;
      setConnection('The host seems to be away. Waiting for them to come back…');
    }
  }

  function ping() {
    if (relay) relay.publish(topic('action'), { id: newId(), clientId, name: myName, action: { type: 'ping' } });
  }

  // ---------- Actions ----------

  function sendAction(action) {
    if (isHost) {
      const result = G.applyAction(state, clientId, action);
      if (!result.ok && result.error) showError(result.error);
      if (result.ok) afterHostChange();
    } else if (relay && hostHeardAt && relay.publish(topic('action'), { id: newId(), clientId, name: myName, action })) {
      // The host answers with a new state, or an error just for us.
    } else {
      showError('Not connected to the host yet.');
    }
  }

  $('board').addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card');
    if (!cardEl || !state || state.over || pendingClaim) return;
    const id = Number(cardEl.dataset.id);
    selected = selected.includes(id) ? selected.filter((c) => c !== id) : selected.concat(id);
    renderBoard();
    if (selected.length === 3) {
      // Leave the cards highlighted until the host answers; a new board
      // clears them, an error shakes and clears them.
      pendingClaim = selected;
      sendAction({ type: 'claim', cards: selected });
    }
  });

  $('vote-button').addEventListener('click', () => sendAction({ type: 'vote' }));
  $('hint-button').addEventListener('click', () => sendAction({ type: 'hint' }));
  $('start-cards').addEventListener('change', (e) => sendAction({ type: 'settings', startCards: Number(e.target.value) }));
  $('hints-on').addEventListener('change', (e) => sendAction({ type: 'settings', hints: e.target.checked }));
  $('deal-button').addEventListener('click', () => sendAction({ type: 'deal' }));
  $('again-button').addEventListener('click', () => sendAction({ type: 'lobby' }));
  // Two clicks to start over, so a stray click doesn't wipe the scores.
  let startOverTimer = null;
  $('new-game-link').addEventListener('click', () => {
    const link = $('new-game-link');
    if (startOverTimer) {
      clearTimeout(startOverTimer);
      startOverTimer = null;
      link.textContent = 'End this game and start a new one';
      sendAction({ type: 'lobby' });
    } else {
      link.textContent = 'Click again to end this game';
      startOverTimer = setTimeout(() => { startOverTimer = null; link.textContent = 'End this game and start a new one'; }, 4000);
    }
  });
  $('copy-button').addEventListener('click', () => {
    const input = $('invite-link');
    input.select();
    const done = () => { $('copy-button').textContent = 'Copied!'; setTimeout(() => { $('copy-button').textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, () => document.execCommand('copy') && done());
    else if (document.execCommand('copy')) done();
  });

  // ---------- Rendering ----------

  function setConnection(text) { $('connection').textContent = text; }

  let messageTimer = null;
  function showError(text) {
    const cards = pendingClaim || selected;
    pendingClaim = null;
    selected = [];
    renderBoard();
    cards.forEach((id) => {
      const el = document.querySelector('.card[data-id="' + id + '"]');
      if (el) { el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
    });
    setMessage(text, 'bad');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => setMessage(state ? state.message : '', ''), 3000);
  }

  function setMessage(text, kind) {
    $('message').textContent = text;
    $('message').className = kind || '';
  }

  function render() {
    if (!state) return;
    renderPlayers();
    renderSettings();
    $('lobby').hidden = state.started;
    $('table').hidden = !state.started;
    if (!state.started) {
      lastBoard = [];
      $('board').innerHTML = '';
      return;
    }

    // Drop selections whose cards are gone.
    selected = selected.filter((c) => state.board.includes(c));
    if (pendingClaim && !pendingClaim.every((c) => state.board.includes(c))) {
      pendingClaim = null;
      selected = [];
    }
    renderBoard();

    const found = state.lastSet && state.lastSet.by === clientId && state.message.endsWith('found a set!');
    clearTimeout(messageTimer);
    setMessage(state.message, found ? 'good' : '');

    const online = G.onlinePlayers(state);
    const voted = state.votes.filter((v) => online.includes(v)).length;
    const iVoted = state.votes.includes(clientId);
    const vote = $('vote-button');
    vote.textContent = online.length > 1
      ? (iVoted ? 'Waiting for others to agree (' + voted + '/' + online.length + ')' : "Can't find a set? Add a row (" + voted + '/' + online.length + ' agree)')
      : "Can't find a set? Add a row";
    vote.classList.toggle('active', iVoted);
    vote.disabled = state.over || state.deck.length === 0;

    const hint = $('hint-button');
    hint.hidden = !state.settings.hints;
    const hintVoted = state.hintVotes.filter((v) => online.includes(v)).length;
    const iHinted = state.hintVotes.includes(clientId);
    const hintUsedUp = state.hint && (state.hint.none || state.hint.shown >= 2);
    const hintLabel = state.hint && state.hint.set ? 'Another hint' : 'Hint';
    hint.textContent = online.length > 1
      ? (iHinted ? 'Waiting for others to agree (' + hintVoted + '/' + online.length + ')' : hintLabel + ' (' + hintVoted + '/' + online.length + ' agree)')
      : hintLabel;
    hint.classList.toggle('active', iHinted);
    hint.disabled = state.over || !!hintUsedUp;
    $('deck-count').textContent = state.deck.length + ' cards left in the deck';

    $('game-over').hidden = !state.over;
    if (state.over) {
      const players = Object.values(state.players);
      const best = Math.max(...players.map((p) => p.score));
      const winners = players.filter((p) => p.score === best).map((p) => p.name);
      $('winner').textContent = winners.length > 1
        ? "It's a tie between " + winners.join(' and ') + '!'
        : winners[0] + ' wins with ' + best + ' sets!';
    }
  }

  function renderSettings() {
    const amHost = state.hostId === clientId;
    $('settings').hidden = !amHost;
    $('start-cards').value = String(state.settings.startCards);
    $('hints-on').checked = state.settings.hints;
    $('settings-summary').hidden = amHost;
    $('settings-summary').textContent = 'The host is starting with ' + state.settings.startCards + ' cards' +
      (state.settings.hints ? ', with hints allowed.' : ' and no hints.');
  }

  function renderPlayers() {
    const list = $('players');
    list.innerHTML = '';
    Object.entries(state.players).forEach(([cid, p]) => {
      const li = document.createElement('li');
      li.className = (p.online ? '' : 'offline') + (cid === clientId ? ' me' : '');
      const name = document.createElement('span');
      name.textContent = p.name + (cid === clientId ? ' (you)' : '');
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = p.score;
      li.append(name, score);
      if (state.votes.includes(cid)) {
        const w = document.createElement('span');
        w.className = 'wants-row';
        w.textContent = 'wants a row';
        li.append(w);
      }
      if (!p.online) li.title = 'Disconnected';
      list.append(li);
    });
  }

  function renderBoard() {
    if (!state || !state.started) return;
    const board = $('board');
    const fresh = state.board.filter((c) => lastBoard.length && !lastBoard.includes(c));
    const sameBoard = state.board.length === board.children.length &&
      state.board.every((c, i) => Number(board.children[i].dataset.id) === c);
    if (!sameBoard) {
      board.innerHTML = '';
      state.board.forEach((id) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'card';
        btn.dataset.id = id;
        btn.innerHTML = window.cardSvg(id);
        if (fresh.includes(id)) btn.classList.add('fresh');
        board.append(btn);
      });
      board.style.setProperty('--cols', Math.ceil(state.board.length / 3));
      lastBoard = state.board.slice();
    }
    const hinted = state.hint && state.hint.set ? state.hint.set.slice(0, state.hint.shown) : [];
    for (const el of board.children) {
      el.classList.toggle('selected', selected.includes(Number(el.dataset.id)));
      el.classList.toggle('hinted', hinted.includes(Number(el.dataset.id)));
    }
  }
})();
