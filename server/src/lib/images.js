// Logo checks (FR-WS-01, D-22): the type is decided by the file's content, not
// its name or declared type, and SVGs that could run code are refused.

const BOM = new RegExp('^\uFEFF');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** "image/png", "image/svg+xml" or null. */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  const head = buffer.subarray(0, 2048).toString('utf8').replace(BOM, '');
  // Optional XML declaration, comments and doctype, then the <svg> root
  const stripped = head.replace(/^\s*(<\?xml[^>]*\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*/i, '');
  if (/^<svg[\s>]/i.test(stripped)) return 'image/svg+xml';
  return null;
}

const UNSAFE_SVG_PATTERNS = [
  /<script[\s>]/i,
  /<foreignObject[\s>]/i,
  /\son[a-z]+\s*=/i, // event handlers: onload=, onclick=
  /javascript:/i,
  /<!ENTITY/i, // entity expansion
  /(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/)/i, // external references
  /@import/i,
];

/** Null when the SVG is acceptable, otherwise the reason. */
export function unsafeSvgReason(buffer) {
  const text = buffer.toString('utf8');
  if (!/<\/svg>\s*$/i.test(text.trim())) return 'The SVG file is incomplete';
  const hit = UNSAFE_SVG_PATTERNS.find((re) => re.test(text));
  return hit ? 'SVG logos must not contain scripts, event handlers or external references' : null;
}
