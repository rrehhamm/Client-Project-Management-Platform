// D-45 appearance setting: System (default), Light or Dark. The resolved mode is a class
// on <html> ("light" or "dark"); tokens.css and Tailwind's dark: variant read it.
// The choice is stored per user on the server; localStorage only remembers it on this
// device so the first paint already has the right colours.

export const APPEARANCES = ['system', 'light', 'dark'];
const KEY = 'cpm.appearance';

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function resolveAppearance(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return media()?.matches ? 'dark' : 'light';
}

let stopListening = null;

/** Sets the class on <html> and, for "system", follows OS changes until called again. */
export function applyAppearance(pref = 'system', root = document.documentElement) {
  const value = APPEARANCES.includes(pref) ? pref : 'system';
  const set = () => {
    const mode = resolveAppearance(value);
    root.classList.toggle('dark', mode === 'dark');
    root.classList.toggle('light', mode === 'light');
  };
  stopListening?.();
  stopListening = null;
  set();
  const mq = media();
  if (value === 'system' && mq?.addEventListener) {
    mq.addEventListener('change', set);
    stopListening = () => mq.removeEventListener('change', set);
  }
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage blocked: the server setting still applies after sign-in.
  }
  return value;
}

export function storedAppearance() {
  try {
    const v = localStorage.getItem(KEY);
    return APPEARANCES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}
