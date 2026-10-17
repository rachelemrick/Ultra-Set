// Page wiring and two-player networking.
//
// The person who starts a game is the host: their browser keeps the real
// game state and applies everyone's moves. Friends connect straight to the
// host's browser with PeerJS (WebRTC), send their moves, and get the
// updated state back. No server of our own is needed, so the whole thing
// can live on GitHub Pages.
(function () {
  'use strict';

  const G = window.UltraSet;
  const $ = (id) => document.getElementById(id);
  const ID_PREFIX = 'ultra-set-';
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

  // Lets tests point at a local PeerJS server, e.g. ?peerhost=localhost&peerport=9000
  const peerOptions = params.get('peerhost')
    ? { host: params.get('peerhost'), port: Number(params.get('peerport') || 9000), path: '/', secure: false }
    : {};

  let isHost = false;
  let peer = null;
  let hostConn = null;            // guest: connection to the host
  const guests = new Map();       // host: connection -> clientId
  let state = null;
  let roomCode = null;
  let selected = [];
  let lastBoard = [];
  let myName = storage.get('ultra-set-name') || '';
  let reconnectTimer = null;
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
      state = saved.state;
      roomCode = saved.code;
      Object.values(state.players).forEach((p) => { p.online = false; });
    } else {
      state = G.createState();
      roomCode = newCode();
    }
    G.applyAction(state, clientId, { type: 'join', name: myName });
    saveHost();
    render();
    openHostPeer();
  }

  function openHostPeer() {
    setConnection('Setting up your game room…');
    peer = new Peer(ID_PREFIX + roomCode, peerOptions);
    peer.on('open', () => {
      const link = location.origin + location.pathname + '?join=' + roomCode;
      $('invite-link').value = link;
      $('invite').hidden = false;
      setConnection('Your game room is open. You can also play on your own.');
    });
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => onGuestMessage(conn, msg));
      conn.on('close', () => onGuestGone(conn));
      conn.on('error', () => onGuestGone(conn));
    });
    peer.on('disconnected', () => {
      // Lost the signalling server; existing games keep working, but new
      // friends can't join until we reconnect.
      setConnection('Reconnecting the game room…');
      setTimeout(() => { if (peer && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Someone else has this room code; pick another.
        peer.destroy();
        roomCode = newCode();
        saveHost();
        openHostPeer();
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        setConnection("Can't reach the connection service right now. You can still play on your own; refresh to try again.");
      } else if (err.type === 'browser-incompatible') {
        setConnection("This browser can't do online play. Try Chrome, Firefox, Safari or Edge.");
      }
    });
  }

  function onGuestMessage(conn, msg) {
    if (!msg || msg.type !== 'action' || !msg.action) return;
    const cid = String(msg.clientId || conn.peer);
    if (msg.action.type === 'join') guests.set(conn, cid);
    if (!guests.has(conn)) return;
    const result = G.applyAction(state, cid, msg.action);
    if (!result.ok && result.error) conn.send({ type: 'error', error: result.error });
    if (result.ok) afterHostChange();
  }

  function onGuestGone(conn) {
    const cid = guests.get(conn);
    guests.delete(conn);
    // Only mark them offline if they don't have another live connection.
    if (cid && ![...guests.values()].includes(cid)) {
      G.applyAction(state, cid, { type: 'leave' });
      afterHostChange();
    }
  }

  function afterHostChange() {
    saveHost();
    for (const conn of guests.keys()) {
      if (conn.open) conn.send({ type: 'state', state });
    }
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
    peer = new Peer(peerOptions);
    peer.on('open', connectToHost);
    peer.on('disconnected', () => {
      setTimeout(() => { if (peer && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        setConnection("Can't find that game. The host may have closed it; trying again…");
        scheduleReconnect();
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        setConnection("Can't reach the connection service. Trying again…");
        scheduleReconnect();
      }
    });
  }

  function connectToHost() {
    clearTimeout(reconnectTimer);
    if (!peer || peer.destroyed || peer.disconnected) return scheduleReconnect();
    const conn = peer.connect(ID_PREFIX + roomCode, { reliable: true });
    hostConn = conn;
    conn.on('open', () => {
      setConnection('Connected.');
      sendAction({ type: 'join', name: myName });
    });
    conn.on('data', (msg) => {
      if (msg.type === 'state') {
        state = msg.state;
        render();
      } else if (msg.type === 'error') {
        showError(msg.error);
      }
    });
    conn.on('close', () => {
      if (hostConn !== conn) return;
      hostConn = null;
      pendingClaim = null;
      selected = [];
      setConnection('Lost the connection to the host. Reconnecting…');
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectToHost, 3000);
  }

  // ---------- Actions ----------

  function sendAction(action) {
    if (isHost) {
      const result = G.applyAction(state, clientId, action);
      if (!result.ok && result.error) showError(result.error);
      if (result.ok) afterHostChange();
    } else if (hostConn && hostConn.open) {
      hostConn.send({ type: 'action', clientId, action });
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
  $('deal-button').addEventListener('click', () => sendAction({ type: 'deal' }));
  $('again-button').addEventListener('click', () => sendAction({ type: 'deal' }));
  $('new-game-link').addEventListener('click', () => {
    if (confirm('Start over with a new deal? Scores go back to zero for everyone.')) sendAction({ type: 'deal' });
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
    $('lobby').hidden = state.started;
    $('table').hidden = !state.started;
    if (!state.started) return;

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
    for (const el of board.children) {
      el.classList.toggle('selected', selected.includes(Number(el.dataset.id)));
    }
  }
})();
