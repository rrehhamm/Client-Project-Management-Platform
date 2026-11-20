// D-45: every colour pair in tokens.css meets WCAG AA (4.5:1 text, 3:1 input borders),
// in both modes, including status text on its soft badge background.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, mix } from '@/lib/brand';

const css = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8');
const [lightBlock, darkBlock] = css.split(':root.dark');

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6}|\d+%);/gi)) out[m[1]] ??= m[2];
  return out;
}

const MODES = { light: tokens(lightBlock), dark: tokens(darkBlock) };

const TEXT = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['foreground', 'muted'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['foreground', 'sidebar'],
  ['muted-foreground', 'sidebar'],
  ['primary-foreground', 'primary'],
  ['brand-text', 'background'],
  ['brand-text', 'card'],
  ['brand-text', 'brand-soft'],
  ['destructive-foreground', 'destructive'],
];

describe.each(Object.entries(MODES))('%s mode tokens', (mode, tk) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(tk[fg], tk[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('input borders are at least 3:1 against page and card', () => {
    expect(contrast(tk.input, tk.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(tk.input, tk.card)).toBeGreaterThanOrEqual(3);
  });

  it.each(['success', 'warning', 'destructive', 'info'])('%s text reads on page, card and its soft background', (status) => {
    const soft = mix(tk.card, tk[status], Number.parseInt(tk['status-soft'], 10) / 100);
    for (const bg of [tk.background, tk.card, soft]) expect(contrast(tk[status], bg)).toBeGreaterThanOrEqual(4.5);
  });
});

it('white text on the light-mode danger button is at least 4.5:1', () => {
  expect(contrast('#FFFFFF', MODES.light.destructive)).toBeGreaterThanOrEqual(4.5);
});
