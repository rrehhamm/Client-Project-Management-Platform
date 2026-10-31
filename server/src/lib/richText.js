// Rich text (task descriptions, comments) is stored as cleaned HTML.
// Only basic formatting and safe links survive (NFR-SEC-02: no stored XSS).
import sanitizeHtml from 'sanitize-html';

const OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'h2', 'h3', 'hr'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
};

/** Cleaned HTML, or null when nothing visible is left. */
export function cleanRichText(html) {
  if (html === null || html === undefined) return html;
  const clean = sanitizeHtml(String(html), OPTIONS).trim();
  const visible = sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').trim();
  return visible ? clean : null;
}

/** The text a reader sees (entities decoded), used for length limits and email snippets. */
export function visibleText(html) {
  if (!html) return '';
  return sanitizeHtml(String(html).replace(/<\/(p|li|h2|h3|blockquote)>|<br\s*\/?>/gi, '$& '), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
