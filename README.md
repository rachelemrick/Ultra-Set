# Ultra Set

A two-player online version of Set with a fifth feature: a corner letter (S, E or T).
That makes 243 unique cards (3^5).

## How to play

1. Open the game, type your name and press **Start a new game**.
2. Copy the invite link and send it to your friend. When they open it and type their name, they appear next to you.
3. The host picks how many cards go on the table at the start (12 to 24) and whether hints are allowed (on unless the host unticks it; the host can also change it during a game), then presses **Deal cards**.
4. A **set** is three cards where each of the five features (color, shape, number, shading, corner letter) is either all the same or all different. Click three cards to claim a set. Whoever claims it first scores a point, and the cards are replaced.
5. If nobody can find a set, everyone presses **Can't find a set? Add a row**. When all players have pressed it, three more cards are added.
6. If hints are on, everyone can press **Hint**. When all players have pressed it, one card from a set gets marked (or the game says there is no set on the table). Asking again marks a second card from the same set.
7. When the deck is empty and no sets are left on the table, the game ends and the highest score wins.

The person who starts the game is the host. Their browser keeps the game, so if the host closes the tab the game pauses; the host can reopen the page and press **Resume my last game**, and friends reconnect on their own.

## How it works

It is a plain web page with no server of its own, so it runs on GitHub Pages.
The host's browser keeps the game. Moves and game updates travel through free public MQTT relays
(HiveMQ, EMQX and Mosquitto's public test servers) over secure WebSockets, which work on home, school
and phone networks alike. Every player connects to all three relays at once, so the game keeps working
as long as both players can reach any one of them. Messages on these public relays are not private,
so don't put anything secret in your player name.

(An earlier version connected the two browsers directly with WebRTC. That failed between many home
networks, so it was replaced.)

The MQTT.js library is included in `vendor/` (MIT licence, see `vendor/mqtt-LICENSE.md`).

- `game.js`: the rules (deck, checking sets, scoring, adding rows, hints)
- `cards.js`: draws the cards
- `relay.js`: sends messages through the relays
- `app.js`: the page and the networking

## Putting it online with GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment**, set **Source** to "Deploy from a branch", pick the `main` branch and the `/ (root)` folder, and save.
After a minute the game is at `https://rachelemrick.github.io/Ultra-Set/`.

## Running the tests

```
node test/game.test.js
```
