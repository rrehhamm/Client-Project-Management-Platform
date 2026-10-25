import { en } from './en.js';

const dictionaries = { en };
let current = dictionaries.en;

/**
 * Look up a UI string by dotted key, e.g. t('states.retry').
 * {name} placeholders are replaced from `vars`. A missing key returns the key
 * itself so gaps are visible instead of blank.
 */
export function t(key, vars) {
  const value = key.split('.').reduce((node, part) => node?.[part], current);
  if (typeof value !== 'string') return key;
  return vars ? value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : value;
}

/**
 * Look up `literalKey` (which may itself contain dots, e.g. "project.archived")
 * inside the object at `path`. Returns null when missing.
 */
export function tIn(path, literalKey, vars) {
  const table = path.split('.').reduce((node, part) => node?.[part], current);
  const value = table?.[literalKey];
  if (typeof value !== 'string') return null;
  return vars ? value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : value;
}

/** A list of strings (e.g. weekday names) by dotted key; [] if missing. */
export function tList(key) {
  const value = key.split('.').reduce((node, part) => node?.[part], current);
  return Array.isArray(value) ? value : [];
}

export function setLocale(locale) {
  current = dictionaries[locale] ?? dictionaries.en;
}
