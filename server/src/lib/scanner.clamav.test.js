// BR-FILE-02 against a real ClamAV daemon (D-30). Runs only when CLAMAV_TEST_HOST is
// set (CI starts ClamAV for this); otherwise it is skipped.
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { EICAR, clamavScan } from './scanner.js';

const host = process.env.CLAMAV_TEST_HOST;
const port = Number(process.env.CLAMAV_TEST_PORT ?? 3310);

describe.skipIf(!host)('ClamAV (real daemon)', () => {
  it('reports the EICAR test file as infected', async () => {
    const result = await clamavScan(Readable.from([Buffer.from(EICAR)]), { host, port });
    expect(result.clean).toBe(false);
    expect(result.signature).toMatch(/eicar/i);
  });

  it('reports an ordinary file as clean, also when sent in many chunks', async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => Buffer.from(`line ${i} of an ordinary text file\n`));
    expect(await clamavScan(Readable.from(chunks), { host, port })).toEqual({ clean: true, signature: null });
  });
});
