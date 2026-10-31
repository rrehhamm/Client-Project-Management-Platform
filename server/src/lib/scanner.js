// BR-FILE-02 virus scanning (D-30).
//   clamav: streams the file to clamd (INSTREAM command)
//   stub:   for tests; flags the standard EICAR test string
//   none:   no scanner; files stay Pending unless DEV_MARK_FILES_CLEAN (development only)
import net from 'node:net';
import { config } from '../config.js';

// The EICAR antivirus test file (harmless; every scanner reports it). Built from two
// halves so this source file is never itself flagged by antivirus software.
export const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');

/** True when uploads can be scanned now. */
export const scannerEnabled = () => config.scanner.mode !== 'none';

async function stubScan(stream) {
  let tail = '';
  for await (const chunk of stream) {
    const text = tail + Buffer.from(chunk).toString('latin1');
    if (text.includes(EICAR)) {
      stream.destroy?.();
      return { clean: false, signature: 'Eicar-Test-Signature' };
    }
    tail = text.slice(-EICAR.length);
  }
  return { clean: true, signature: null };
}

export function clamavScan(stream, { host = config.scanner.host, port = config.scanner.port, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let reply = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };
    socket.setTimeout(timeoutMs, () => finish(reject, new Error('Virus scanner timed out')));
    socket.on('error', (err) => finish(reject, err));
    socket.on('data', (d) => {
      reply += d.toString('utf8');
      if (!reply.includes('\0')) return;
      const line = reply.replace(/\0.*$/s, '').trim(); // "stream: OK" | "stream: <name> FOUND" | "... ERROR"
      if (/:\s*OK$/.test(line)) finish(resolve, { clean: true, signature: null });
      else if (/FOUND$/.test(line)) finish(resolve, { clean: false, signature: line.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
      else finish(reject, new Error(`Virus scanner error: ${line}`));
    });
    socket.on('connect', async () => {
      try {
        socket.write('zINSTREAM\0');
        for await (const chunk of stream) {
          const buf = Buffer.from(chunk);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(buf.length);
          if (!socket.write(Buffer.concat([size, buf]))) await new Promise((r) => socket.once('drain', r));
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      } catch (err) {
        finish(reject, err);
      }
    });
  });
}

/** Scan a readable stream. Resolves { clean, signature }; rejects when the scanner is unreachable. */
export function scanStream(stream, options) {
  if (config.scanner.mode === 'stub') return stubScan(stream);
  if (config.scanner.mode === 'clamav') return clamavScan(stream, options);
  return Promise.reject(new Error('No virus scanner configured'));
}
