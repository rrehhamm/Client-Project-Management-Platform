// Second line of defence for rich text (NFR-SEC-02). The server already cleans
// comments and descriptions; before showing them we keep only the same small set
// of tags and http(s)/mailto links again, so a server bug cannot become stored XSS.
const TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'CODE', 'PRE', 'BLOCKQUOTE', 'H2', 'H3', 'HR']);
const SAFE_LINK = /^(https?:|mailto:)/i;

function clean(node, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE || !TAGS.has(child.tagName)) {
      // Unknown elements are replaced by their text; scripts and styles disappear entirely
      const keepText = child.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE'].includes(child.tagName);
      child.replaceWith(keepText ? doc.createTextNode(child.textContent ?? '') : doc.createTextNode(''));
      continue;
    }
    for (const attr of [...child.attributes]) {
      const keep = child.tagName === 'A' && attr.name === 'href' && SAFE_LINK.test(attr.value.trim());
      if (!keep) child.removeAttribute(attr.name);
    }
    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    clean(child, doc);
  }
}

/** Safe HTML string for dangerouslySetInnerHTML. */
export function safeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  clean(root, doc);
  return root.innerHTML;
}
