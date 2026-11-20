// D-45: brand colour contrast protection.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandCss, brandTokens, contrast, DEFAULT_BRAND, mix, SURFACES } from './brand';

const SAMPLES = ['#3E5BA3', '#2563EB', '#84D175', '#0C2D45', '#FACC15', '#22C55E', '#000000', '#FFFFFF', '#E11D48', '#7C3AED', '#06B6D4', '#F97316', '#808080'];

describe('brand tokens', () => {
  it('keeps the default blue unchanged in light mode', () => {
    expect(brandTokens(DEFAULT_BRAND).light).toMatchObject({
      primary: '#3E5BA3',
      primaryForeground: '#FFFFFF',
    });
  });

  it('falls back to the default for invalid input', () => {
    expect(brandTokens('red')).toEqual(brandTokens(DEFAULT_BRAND));
    expect(brandTokens(null)).toEqual(brandTokens(DEFAULT_BRAND));
  });

  for (const color of SAMPLES) {
    for (const mode of ['light', 'dark']) {
      it(`${color} in ${mode} mode passes WCAG AA`, () => {
        const s = SURFACES[mode];
        const tk = brandTokens(color)[mode];
        for (const surface of [s.background, s.card, tk.brandSoft]) expect(contrast(tk.brandText, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tk.primary, tk.primaryForeground)).toBeGreaterThanOrEqual(4.5);
        for (const surface of [s.background, s.card]) expect(contrast(tk.primary, surface)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('darkens a light brand colour in light mode and keeps it bright in dark mode', () => {
    const { light, dark } = brandTokens('#FACC15');
    expect(contrast(light.brandText, '#FFFFFF')).toBeGreaterThan(contrast('#FACC15', '#FFFFFF'));
    expect(dark.primary).toBe('#FACC15');
    expect(dark.primaryForeground).toBe('#0C2D45');
  });

  it('writes CSS for both modes', () => {
    const css = brandCss('#7C3AED');
    expect(css).toMatch(/^:root\{--primary:#7C3AED;/);
    expect(css).toContain(':root.dark{');
  });

  it('matches the default brand values and surfaces in tokens.css', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../styles/tokens.css'), 'utf8').toLowerCase();
    const [lightBlock, darkBlock] = css.split(':root.dark');
    const { light, dark } = brandTokens(DEFAULT_BRAND);
    const has = (block, name, value) => expect(block).toContain(`--${name}: ${value.toLowerCase()};`);
    for (const [block, tk, s] of [
      [lightBlock, light, SURFACES.light],
      [darkBlock, dark, SURFACES.dark],
    ]) {
      has(block, 'primary', tk.primary);
      has(block, 'primary-foreground', tk.primaryForeground);
      has(block, 'brand-text', tk.brandText);
      has(block, 'brand-soft', tk.brandSoft);
      has(block, 'background', s.background);
      has(block, 'card', s.card);
    }
  });

  it('mixes colours in sRGB', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});
