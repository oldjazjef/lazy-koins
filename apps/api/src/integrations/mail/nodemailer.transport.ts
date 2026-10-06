import { createTransport } from 'nodemailer';
import {
  type MailDelivery,
  type MailErrorDetail,
  type MailErrorKind,
  MailTransportError,
  MailTransportPort,
  type OutgoingMail,
  type SmtpConnection,
} from './mail-transport.port';
import { redactSecrets } from './redact';

/** Timeouts: a mail server that does not answer must not hold a request for minutes. */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 60_000,
  dnsTimeout: 10_000,
} as const;

/**
 * The SMTP adapter (F11.10, F10.6a) over nodemailer: one connection per mail, no pool. TLS
 * certificates are always verified (`rejectUnauthorized`); `starttls` requires the upgrade
 * (`requireTLS`), `tls` is implicit TLS, `none` never upgrades. Attachments are only in-memory
 * buffers — file and URL access are switched off. Nothing is logged; errors carry redacted
 * details only.
 */
export class NodemailerTransport extends MailTransportPort {
  constructor(
    private readonly timeouts: Partial<typeof SMTP_TIMEOUTS> = SMTP_TIMEOUTS,
  ) {
    super();
  }

  async send(
    connection: SmtpConnection,
    mail: OutgoingMail,
  ): Promise<MailDelivery> {
    const transport = createTransport({
      host: connection.host,
      port: connection.port,
      secure: connection.security === 'tls',
      requireTLS: connection.security === 'starttls',
      ignoreTLS: connection.security === 'none',
      ...(connection.username !== ''
        ? {
            auth: {
              user: connection.username,
              pass: connection.password ?? '',
            },
          }
        : {}),
      ...SMTP_TIMEOUTS,
      ...this.timeouts,
      tls: { rejectUnauthorized: true, servername: connection.host },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    try {
      const info = await transport.sendMail({
        from: { name: mail.from.name, address: mail.from.address },
        to: [...mail.to],
        cc: [...mail.cc],
        subject: mail.subject,
        text: mail.text,
        attachments: mail.attachments.map((attachment) => ({
          filename: attachment.fileName,
          contentType: attachment.contentType,
          content: Buffer.from(attachment.content),
        })),
      });
      return {
        messageId: String(info.messageId ?? ''),
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
        response: redactSecrets(
          String(info.response ?? ''),
          connection.password,
          connection.username,
        ),
      };
    } catch (error) {
      throw new MailTransportError(describeSmtpError(error, connection));
    } finally {
      transport.close();
    }
  }
}

const TLS_HINT =
  /certificate|self[- ]signed|SSL|TLS|wrong version number|CERT_|UNABLE_TO_VERIFY|ERR_SSL/i;

/** Turns whatever nodemailer or the socket threw into precise, redacted details. */
export function describeSmtpError(
  error: unknown,
  connection: SmtpConnection,
): MailErrorDetail {
  const source = (error ?? {}) as {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
    command?: unknown;
    message?: unknown;
    reason?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code = typeof source.code === 'string' ? source.code : null;
  const causeCode =
    typeof source.cause?.code === 'string' ? source.cause.code : null;
  const smtpCode =
    typeof source.responseCode === 'number' ? source.responseCode : null;
  const message = typeof source.message === 'string' ? source.message : '';
  const raw =
    typeof source.response === 'string' && source.response !== ''
      ? source.response
      : message;
  const kind = classify(code, causeCode, smtpCode, message);
  return {
    kind,
    host: connection.host,
    port: connection.port,
    smtpCode,
    response:
      raw === ''
        ? null
        : redactSecrets(raw, connection.password, connection.username),
    command: typeof source.command === 'string' ? source.command : null,
    code: causeCode && causeCode !== code ? `${code}/${causeCode}` : code,
  };
}

function classify(
  code: string | null,
  causeCode: string | null,
  smtpCode: number | null,
  message: string,
): MailErrorKind {
  const codes = [code, causeCode].filter((c): c is string => c !== null);
  if (codes.some((c) => c === 'EAUTH' || c === 'ENOAUTH')) return 'auth';
  if (smtpCode === 535 || smtpCode === 534 || smtpCode === 530) return 'auth';
  if (
    codes.some(
      (c) => c === 'ETLS' || c === 'EREQUIRETLS' || /^ERR_SSL|CERT/.test(c),
    ) ||
    TLS_HINT.test(message)
  ) {
    return 'tls';
  }
  if (codes.some((c) => c === 'EDNS' || c === 'ENOTFOUND' || c === 'EAI_AGAIN'))
    return 'dns';
  if (codes.some((c) => c === 'ETIMEDOUT')) return 'timeout';
  if (codes.some((c) => c === 'EENVELOPE' || c === 'EMESSAGE'))
    return 'rejected';
  if (smtpCode !== null && smtpCode >= 400) return 'rejected';
  if (codes.some((c) => c === 'EPROTOCOL')) return 'protocol';
  if (
    codes.some(
      (c) =>
        c === 'ECONNECTION' ||
        c === 'ESOCKET' ||
        c === 'ECONNREFUSED' ||
        c === 'ECONNRESET' ||
        c === 'EHOSTUNREACH',
    )
  ) {
    return 'connection';
  }
  return 'unknown';
}
