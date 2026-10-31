// BR-FILE-01: a file's type is decided by its content (magic bytes), not only its
// name. The extension must be on the allow list (FR-FILE-01) and the bytes must
// match it; anything else is 415.
import { FILE_TYPES, fileExtension } from '@cpm/shared';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from './errors.js';
import { detectImageType } from './images.js';

/** Bytes read before deciding (enough for Office files, whose markers sit after the zip header). */
export const HEAD_BYTES = 64 * 1024;

const OOXML = ['docx', 'xlsx', 'pptx'];
const LEGACY_OFFICE = ['doc', 'xls', 'ppt'];

const unsupported = (message) => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message, [{ field: 'file', message }]);

/** The extension is allowed (FR-FILE-01, TC-FILE-001). Returns the expected content type. */
export function allowedTypeFor(name) {
  const ext = fileExtension(name);
  const type = FILE_TYPES[ext];
  if (!type) throw unsupported(ext ? `.${ext} files are not allowed` : 'Files need an extension such as .pdf or .png');
  return { ext, type };
}

function isPlainText(head) {
  if (head.includes(0)) return false;
  // A multi-byte character may be cut at the end of the sample; ignore the last 3 bytes
  const sample = head.length >= HEAD_BYTES ? head.subarray(0, head.length - 3) : head;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check the first bytes against the extension. Returns the content type to store.
 * @param {Buffer} head  the first HEAD_BYTES of the file (or all of it, if smaller)
 */
export async function checkFileContent(name, head) {
  const { ext, type } = allowedTypeFor(name);
  const mismatch = () => unsupported(`This file's content does not match .${ext}`); // TC-FILE-002

  if (ext === 'txt') {
    if (!isPlainText(head) || (await fileTypeFromBuffer(head))) throw mismatch();
    return type;
  }
  if (ext === 'svg') {
    if (detectImageType(head) !== 'image/svg+xml') throw mismatch();
    return type;
  }
  const found = (await fileTypeFromBuffer(head))?.mime;
  const ok =
    found === type ||
    (OOXML.includes(ext) && found === 'application/zip') || // the Office markers can sit beyond the sample
    (LEGACY_OFFICE.includes(ext) && found === 'application/x-cfb') ||
    (ext === 'mp4' && ['video/mp4', 'video/x-m4v'].includes(found)) ||
    (ext === 'zip' && OOXML.some((x) => FILE_TYPES[x] === found)); // an Office file renamed .zip is still a zip
  if (!ok) throw mismatch();
  return type;
}
