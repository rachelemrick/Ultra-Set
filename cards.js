// Draws a card as an SVG string.
(function (root) {
  'use strict';

  const COLORS = { red: '#d6283a', green: '#0b9447', purple: '#6a2ca0' };

  // Shapes are drawn lying down in an 80x40 box, then stood upright.
  const SHAPES = {
    diamond: '<path d="M2 20 L40 2 L78 20 L40 38 Z"/>',
    oval: '<rect x="2" y="2" width="76" height="36" rx="18"/>',
    squiggle: '<path d="M5 29 C1 14 14 2 30 6 C42 9 50 13 62 7 C72 2 80 7 77 17 C74 29 61 38 48 34 C38 31 30 28 19 34 C11 38 6 35 5 29 Z"/>',
  };

  const W = 140, H = 100, SYMBOL_W = 32, SYMBOL_H = 64, GAP = 10;

  function cardSvg(id) {
    const card = root.UltraSet.describeCard(id);
    const color = COLORS[card.color];
    const fill = card.shading === 'solid' ? color
      : card.shading === 'striped' ? 'url(#stripes-' + card.color + ')'
      : 'none';
    const total = card.number * SYMBOL_W + (card.number - 1) * GAP;
    let symbols = '';
    for (let i = 0; i < card.number; i++) {
      const x = (W - total) / 2 + i * (SYMBOL_W + GAP);
      const y = (H - SYMBOL_H) / 2;
      symbols += '<g transform="translate(' + x + ' ' + y + ') scale(0.8) translate(40 0) rotate(90)"' +
        ' fill="' + fill + '" stroke="' + color + '" stroke-width="3.5">' + SHAPES[card.shape] + '</g>';
    }
    const label = [card.number, card.color, card.shading, card.shape + (card.number > 1 ? 's' : ''), 'letter ' + card.letter].join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + label + '">' +
      '<text x="9" y="19" class="corner">' + card.letter + '</text>' + symbols + '</svg>';
  }

  root.cardSvg = cardSvg;
})(this);
