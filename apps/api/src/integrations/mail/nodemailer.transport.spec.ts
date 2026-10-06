import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { MailTransportError, type SmtpConnection } from './mail-transport.port';
import { describeSmtpError, NodemailerTransport } from './nodemailer.transport';
import { redactSecrets } from './redact';

/**
 * The real nodemailer adapter against a local SMTP sink (`smtp-server` on 127.0.0.1, random
 * port) — no mail ever leaves the machine.
 */
const PASSWORD = 'S3cret-Passw0rd!';

interface Received {
  from: string;
  to: string[];
  raw: string;
}

async function sink(options: { failRcpt?: boolean } = {}) {
  const received: Received[] = [];
  const server = new SMTPServer({
    secure: false,
    authOptional: false,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === 'anna' && auth.password === PASSWORD) {
        callback(null, { user: 'anna' });
      } else {
        callback(new Error(`Invalid credentials for ${auth.username}`));
      }
    },
    onRcptTo(address, _session, callback) {
      if (options.failRcpt) {
        const error = new Error('Mailbox unavailable') as Error & {
          responseCode: number;
        };
        error.responseCode = 550;
        callback(error);
        return;
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom
            ? session.envelope.mailFrom.address
            : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.server.address() as AddressInfo).port;
  return {
    port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const connection = (port: number, over: Partial<SmtpConnection> = {}) =>
  ({
    host: '127.0.0.1',
    port,
    security: 'none',
    username: 'anna',
    password: PASSWORD,
    ...over,
  }) satisfies SmtpConnection;

const MAIL = {
  from: { name: 'Anna Muster', address: 'anna@example.ch' },
  to: ['treuhand@example.ch'],
  cc: ['anna@example.ch'],
  subject: 'Steuern 2025: Krypto-Vermögen und Ertrag',
  text: 'Guten Tag\n\nAnbei meine Unterlagen.',
  attachments: [
    {
      fileName: 'Steuern-2025_einfach_2026-02-01.pdf',
      contentType: 'application/pdf',
      content: new TextEncoder().encode('%PDF-1.4 synthetic'),
    },
  ],
};

describe('NodemailerTransport (local SMTP sink)', () => {
  it('sends text and attachments to all recipients', async () => {
    const server = await sink();
    try {
      const delivery = await new NodemailerTransport().send(
        connection(server.port),
        MAIL,
      );
      expect(delivery.accepted).toEqual([
        'treuhand@example.ch',
        'anna@example.ch',
      ]);
      expect(delivery.response).toMatch(/^250/);
      expect(server.received).toHaveLength(1);
      const [mail] = server.received;
      expect(mail?.to).toEqual(['treuhand@example.ch', 'anna@example.ch']);
      expect(mail?.raw).toContain('Steuern-2025_einfach_2026-02-01.pdf');
      expect(mail?.raw).toContain('Content-Type: application/pdf');
      expect(mail?.raw).toContain(
        Buffer.from('%PDF-1.4 synthetic').toString('base64'),
      );
      expect(mail?.raw).not.toContain(PASSWORD);
    } finally {
      await server.close();
    }
  });

  it('reports a refused login as auth, without the password', async () => {
    const server = await sink();
    try {
      const error = await new NodemailerTransport()
        .send(connection(server.port, { password: 'wrong-passw0rd' }), MAIL)
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(MailTransportError);
      const detail = (error as MailTransportError).detail;
      expect(detail).toMatchObject({
        kind: 'auth',
        host: '127.0.0.1',
        port: server.port,
        smtpCode: 535,
      });
      expect(JSON.stringify(detail)).not.toContain('wrong-passw0rd');
      expect(
        JSON.stringify(detail).includes(
          Buffer.from('wrong-passw0rd').toString('base64'),
        ),
      ).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('reports a refused recipient as rejected with the SMTP code', async () => {
    const server = await sink({ failRcpt: true });
    try {
      const error = (await new NodemailerTransport()
        .send(connection(server.port), MAIL)
        .catch((e: unknown) => e)) as MailTransportError;
      expect(error.detail.kind).toBe('rejected');
      expect(error.detail.smtpCode).toBe(550);
    } finally {
      await server.close();
    }
  });

  it('reports a closed port as a connection problem', async () => {
    const server = await sink();
    const port = server.port;
    await server.close();
    const error = (await new NodemailerTransport({
      connectionTimeout: 2000,
    })
      .send(connection(port), MAIL)
      .catch((e: unknown) => e)) as MailTransportError;
    expect(error).toBeInstanceOf(MailTransportError);
    expect(error.detail.kind).toBe('connection');
    expect(error.detail.host).toBe('127.0.0.1');
  });

  it('requires STARTTLS when asked to and the server does not offer it', async () => {
    const server = await sink();
    try {
      const error = (await new NodemailerTransport()
        .send(connection(server.port, { security: 'starttls' }), MAIL)
        .catch((e: unknown) => e)) as MailTransportError;
      expect(error).toBeInstanceOf(MailTransportError);
      expect(error.detail.kind).toBe('tls');
    } finally {
      await server.close();
    }
  });
});

describe('describeSmtpError', () => {
  it('classifies certificate problems as tls', () => {
    const detail = describeSmtpError(
      Object.assign(new Error('self-signed certificate'), {
        code: 'ESOCKET',
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      }),
      connection(465, { security: 'tls' }),
    );
    expect(detail).toMatchObject({
      kind: 'tls',
      code: 'ESOCKET/DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });

  it('redacts the password and AUTH tokens in what the server said', () => {
    const plain = Buffer.from(`\u0000anna\u0000${PASSWORD}`).toString('base64');
    const detail = describeSmtpError(
      {
        code: 'EAUTH',
        responseCode: 535,
        response: `535 rejected AUTH PLAIN ${plain} for ${PASSWORD}`,
        command: 'AUTH PLAIN',
      },
      connection(587),
    );
    expect(detail.kind).toBe('auth');
    expect(detail.response).toBe(
      '535 rejected AUTH PLAIN [redacted] for [redacted]',
    );
  });
});

describe('redactSecrets', () => {
  it('removes the password in plain and base64, and trims', () => {
    const b64 = Buffer.from(PASSWORD).toString('base64');
    expect(redactSecrets(`x ${PASSWORD} y ${b64} z`, PASSWORD)).toBe(
      'x [redacted] y [redacted] z',
    );
    expect(redactSecrets('a'.repeat(900), undefined)).toHaveLength(500);
    expect(redactSecrets('AUTH LOGIN dXNlcg==', undefined)).toBe(
      'AUTH LOGIN [redacted]',
    );
  });
});
