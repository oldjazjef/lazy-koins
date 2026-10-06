#!/usr/bin/env node
/**
 * A local SMTP sink for trying "An Treuhänder senden" (F10.6a) and "Test-Mail an mich senden"
 * (F11.10) without a real mail account: accepts every mail on 127.0.0.1, sends nothing on, and
 * writes each one as an `.eml` file to tmp/smtp-sink/ (git-ignored). Prints sender, recipients,
 * subject and size — never the password.
 *
 *   node scripts/dev/smtp-sink.mjs [port]      # default 2525
 *
 * Settings in the app: server 127.0.0.1 (or localhost), the port, security "Keine", any user and
 * password (or none). Private hosts are allowed with AUTH_MODE=dev/local; on a firebase server
 * set MAIL_ALLOW_PRIVATE_HOSTS=true for this. The user "reject" is refused (to try the error
 * display), as is any recipient starting with "bounce@".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMTPServer } from 'smtp-server';

const port = Number(process.argv[2] ?? process.env.SMTP_SINK_PORT ?? 2525);
const outDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../tmp/smtp-sink',
);
mkdirSync(outDir, { recursive: true });

let count = 0;
const server = new SMTPServer({
  secure: false,
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  size: 30 * 1024 * 1024,
  onAuth(auth, _session, callback) {
    if (auth.username === 'reject') {
      callback(
        new Error('Authentication rejected by the sink (user "reject")'),
      );
      return;
    }
    callback(null, { user: auth.username });
  },
  onRcptTo(address, _session, callback) {
    if (address.address.startsWith('bounce@')) {
      const error = new Error(`Mailbox unavailable: ${address.address}`);
      error.responseCode = 550;
      callback(error);
      return;
    }
    callback();
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      count += 1;
      const raw = Buffer.concat(chunks);
      const text = raw.toString('utf8');
      const subject = /^Subject: (.*)$/im.exec(text)?.[1] ?? '';
      const attachments = [...text.matchAll(/filename="?([^";\r\n]+)"?/gi)].map(
        (m) => m[1],
      );
      const file = path.join(
        outDir,
        `${new Date().toISOString().replace(/[:.]/g, '-')}_${count}.eml`,
      );
      writeFileSync(file, raw);
      console.log(
        `#${count} from ${session.envelope.mailFrom ? session.envelope.mailFrom.address : '?'} to ${session.envelope.rcptTo.map((r) => r.address).join(', ')} | ${subject} | ${raw.length} bytes${attachments.length ? ` | attachments: ${attachments.join(', ')}` : ''} -> ${path.relative(process.cwd(), file)}`,
      );
      callback();
    });
  },
});

server.on('error', (error) => console.error('smtp-sink:', error.message));
server.listen(port, '127.0.0.1', () => {
  console.log(`smtp-sink listening on 127.0.0.1:${port}, mails -> ${outDir}`);
});
