/* global localStorage, window, document */
// D-45: set the light/dark class before the first paint (no flash). Mirrors
// src/lib/appearance.js, which takes over once the app has loaded. External file
// because the production CSP does not allow inline scripts.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('cpm.appearance') || 'system';
  } catch (e) {
    /* storage blocked */
  }
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.add(dark ? 'dark' : 'light');
})();
