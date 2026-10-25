// D-02: 3-letter project-code prefix. First choice is the first three letters
// (Nova Retail → NOV); when taken, the first letter plus two later consonants
// (NVR), then any two later letters, then any free combination.
import { db } from '../../lib/db.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Candidate prefixes for a client name, best first. */
export function prefixCandidates(name) {
  const plain = String(name).normalize('NFKD').replace(/\p{M}/gu, ''); // strip accents: Café → Cafe
  const letters = plain.replace(/[^A-Za-z]/g, '').toUpperCase();

  const out = [];
  const push = (p) => {
    if (/^[A-Z]{3}$/.test(p) && !out.includes(p)) out.push(p);
  };

  push(letters.slice(0, 3));

  const first = letters[0] ?? 'C'; // names without Latin letters fall back to C…
  const rest = letters.slice(1);
  const consonants = rest.replace(/[AEIOU]/g, '');
  for (let i = 0; i < consonants.length; i++) {
    for (let j = i + 1; j < consonants.length; j++) push(first + consonants[i] + consonants[j]);
  }
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) push(first + rest[i] + rest[j]);
  }
  return out;
}

/** Every 3-letter combination starting with `first`, then all others (last resort). */
function* fallbackPrefixes(first) {
  for (const a of LETTERS) for (const b of LETTERS) yield first + a + b;
  for (const x of LETTERS) for (const a of LETTERS) for (const b of LETTERS) yield x + a + b;
}

/** The best prefix for `name` that no client in the workspace uses yet. */
export async function suggestPrefix(workspaceId, name, client = db) {
  const taken = new Set(
    (await client.client.findMany({ where: { workspace_id: workspaceId }, select: { code_prefix: true } })).map((c) => c.code_prefix),
  );
  const candidates = prefixCandidates(name);
  const free = candidates.find((p) => !taken.has(p));
  if (free) return free;
  const first = candidates[0]?.[0] ?? 'C';
  for (const p of fallbackPrefixes(first)) if (!taken.has(p)) return p;
  throw new Error('No free project-code prefix left');
}
