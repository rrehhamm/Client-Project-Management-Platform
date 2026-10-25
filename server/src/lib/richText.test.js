import { describe, expect, it } from 'vitest';
import { cleanRichText } from './richText.js';

describe('cleanRichText (NFR-SEC-02)', () => {
  it('keeps basic formatting and safe links', () => {
    expect(cleanRichText('<p><strong>Bold</strong> <em>it</em></p><ul><li>One</li></ul>')).toBe('<p><strong>Bold</strong> <em>it</em></p><ul><li>One</li></ul>');
    expect(cleanRichText('<a href="mailto:a@b.test">mail</a>')).toBe('<a href="mailto:a@b.test" target="_blank" rel="noopener noreferrer nofollow">mail</a>');
  });
  it('removes scripts, event handlers, styles and unsafe links (TC-COM-002 style)', () => {
    const out = cleanRichText('<p onclick="x()" style="color:red">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="https://evil.test"></iframe>');
    expect(out).toBe('<p>Hi</p><a target="_blank" rel="noopener noreferrer nofollow">x</a>');
  });
  it('returns null when nothing visible is left', () => {
    expect(cleanRichText('<p> </p><p><br></p>')).toBeNull();
    expect(cleanRichText(null)).toBeNull();
  });
});
