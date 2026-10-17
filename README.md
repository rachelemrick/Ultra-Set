# Ultra Set

A two-player online version of Set with a fifth feature: a corner letter (S, E or T).
That makes 243 unique cards (3^5).

## How to play

1. Open the game, type your name and press **Start a new game**.
2. Copy the invite link and send it to your friend. When they open it and type their name, they appear next to you.
3. Press **Deal cards**. Twelve cards go on the table.
4. A **set** is three cards where each of the five features (color, shape, number, shading, corner letter) is either all the same or all different. Click three cards to claim a set. Whoever claims it first scores a point, and the cards are replaced.
5. If nobody can find a set, everyone presses **Can't find a set? Add a row**. When all players have pressed it, three more cards are added.
6. When the deck is empty and no sets are left on the table, the game ends and the highest score wins.

The person who starts the game is the host. Their browser keeps the game, so if the host closes the tab the game pauses; the host can reopen the page and press **Resume my last game**, and friends reconnect on their own.

## How it works

It is a plain web page with no server of its own, so it runs on GitHub Pages.
Players' browsers connect straight to each other with [PeerJS](https://peerjs.com) (WebRTC); PeerJS's free public service only introduces the two browsers.
The PeerJS library is included in `vendor/` (MIT licence, see `vendor/peerjs-LICENSE`).

- `game.js`: the rules (deck, checking sets, scoring, adding rows)
- `cards.js`: draws the cards
- `app.js`: the page and the networking

## Putting it online with GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment**, set **Source** to "Deploy from a branch", pick the `main` branch and the `/ (root)` folder, and save.
After a minute the game is at `https://rachelemrick.github.io/Ultra-Set/`.

## Running the tests

```
node test/game.test.js
```
