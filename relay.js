// Passes messages between players through free public MQTT relays.
//
// Browsers can't reliably connect straight to each other across home
// networks, but every browser can open a secure WebSocket to a server.
// So each player connects to several public relays at once and messages
// go out on every relay that is up. As long as both players can reach
// one of them, the game works. Repeats are filtered out by the caller.
(function (root) {
  'use strict';

  const DEFAULT_BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];

  function createRelay(brokers, onStatus) {
    const clients = brokers.map((url) => {
      const client = root.mqtt.connect(url, {
        clientId: 'ultra-set-' + Math.random().toString(36).slice(2, 12),
        clean: true,
        keepalive: 30,
        connectTimeout: 8000,
        reconnectPeriod: 4000,
      });
      client.on('connect', report);
      client.on('close', report);
      client.on('offline', report);
      client.on('error', () => {}); // reconnects on its own
      return client;
    });
    const handlers = []; // { topic, fn }

    clients.forEach((client) => {
      client.on('connect', () => {
        handlers.forEach((h) => client.subscribe(h.topic, { qos: 1 }));
      });
      client.on('message', (topic, payload, packet) => {
        let msg;
        try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        handlers.forEach((h) => { if (h.topic === topic) h.fn(msg, { retained: !!packet.retain }); });
      });
    });

    function connectedCount() {
      return clients.filter((c) => c.connected).length;
    }

    function report() {
      if (onStatus) onStatus(connectedCount());
    }

    return {
      connectedCount,
      subscribe(topic, fn) {
        handlers.push({ topic, fn });
        clients.forEach((c) => { if (c.connected) c.subscribe(topic, { qos: 1 }); });
      },
      publish(topic, msg, options) {
        const payload = JSON.stringify(msg);
        let sent = 0;
        clients.forEach((c) => {
          if (c.connected) { c.publish(topic, payload, { qos: 1, retain: !!(options && options.retain) }); sent++; }
        });
        return sent > 0;
      },
    };
  }

  root.UltraSetRelay = { DEFAULT_BROKERS, createRelay };
})(this);
