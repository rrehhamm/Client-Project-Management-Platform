// D-45: the workspace brand colour is the accent of the whole app (internal and portal).
// A company can pick any colour, so it is adjusted until it meets WCAG AA:
//   - text in the brand colour (links, active navigation): 4.5:1 on page and card;
//   - a brand button: 3:1 against the page (WCAG 1.4.11) and 4.5:1 for its label.
// Light mode darkens the colour, dark mode lightens it, in 2% steps, keeping its hue.
// Status colours (success, warning, danger, info) are fixed and never derived from it.

export const DEFAULT_BRAND = '#2563EB';

// Surfaces the brand colour sits on. Must match src/styles/tokens.css.
export const SURFACES = {
  light: { background: '#F8FAFC', card: '#FFFFFF', foreground: '#0F172A' },
  dark: { background: '#0F172A', card: '#172033', foreground: '#F1F5F9' },
};

// Dark label for light buttons, in both modes.
const INK = '#0F172A';

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value) {
  return typeof value === 'string' && HEX.test(value);
}

function toRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Mixes `hex` toward `target` by `amount` (0–1) in sRGB. */
export function mix(hex, target, amount) {
  const a = toRgb(hex);
  const b = toRgb(target);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hex colours (1–21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves `hex` toward `target` until every check passes (or the target is reached). */
function adjust(hex, target, passes) {
  for (let step = 0; step <= 50; step += 1) {
    const candidate = mix(hex, target, step / 50);
    if (passes(candidate)) return candidate;
  }
  return target.toUpperCase();
}

const worst = (color, surfaces) => Math.min(...surfaces.map((s) => contrast(color, s)));

function derive(brand, mode) {
  const s = SURFACES[mode];
  const toward = mode === 'light' ? '#000000' : '#FFFFFF';
  const page = [s.background, s.card];

  // Text and focus ring in the brand colour, readable on the page, on cards and on its
  // own soft tint (the active navigation item).
  const softAmount = mode === 'light' ? 0.1 : 0.18;
  const softOf = (c) => mix(s.card, c, softAmount);
  const text = adjust(brand, toward, (c) => worst(c, [...page, softOf(c)]) >= 4.5);

  // Button: keep the colour as is when white or dark text on it reads at 4.5:1 and the
  // button stands out from the page at 3:1. Otherwise use the adjusted text colour.
  const labelFor = (bg) => (contrast(bg, '#FFFFFF') >= contrast(bg, INK) ? '#FFFFFF' : INK);
  const buttonOk = (bg) => contrast(bg, labelFor(bg)) >= 4.5 && worst(bg, page) >= 3;
  const primary = buttonOk(brand) ? brand.toUpperCase() : adjust(brand, toward, buttonOk);

  return {
    primary,
    primaryForeground: labelFor(primary),
    brandText: text,
    ring: text,
    // Quiet tint for selected rows and the active navigation item.
    brandSoft: softOf(text),
  };
}

/** Both modes' brand tokens for a workspace colour. Invalid input falls back to the default. */
export function brandTokens(color) {
  const brand = isHex(color) ? color : DEFAULT_BRAND;
  return { light: derive(brand, 'light'), dark: derive(brand, 'dark') };
}

const cssVars = (t) =>
  `--primary:${t.primary};--primary-foreground:${t.primaryForeground};--brand-text:${t.brandText};--brand-soft:${t.brandSoft};--ring:${t.ring};`;

/** CSS rules that override the default brand tokens. */
export function brandCss(color) {
  const { light, dark } = brandTokens(color);
  return `:root{${cssVars(light)}}:root.dark{${cssVars(dark)}}`;
}

/** Applies the brand colour to the page by (re)writing one <style> element. */
export function applyBrand(color, doc = document) {
  let el = doc.getElementById('brand-tokens');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'brand-tokens';
    doc.head.append(el);
  }
  el.textContent = brandCss(color);
}
