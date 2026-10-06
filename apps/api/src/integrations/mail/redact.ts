const MAX_LENGTH = 500;
const REDACTED = '[redacted]';

/**
 * Removes the SMTP password from a text that may reach a log, the database or the app: every
 * occurrence of the password, its base64 form and the `AUTH PLAIN` token (SMTP sends credentials
 * base64-encoded, so a server or a library error can echo them), plus whatever follows an `AUTH`
 * command. Control characters are dropped and the text is trimmed to 500 characters.
 */
export function redactSecrets(
  text: string,
  password: string | undefined,
  username = '',
): string {
  let out = text.replace(
    /\b(AUTH\s+(?:PLAIN|LOGIN|XOAUTH2|CRAM-MD5))\s+\S+/gi,
    `$1 ${REDACTED}`,
  );
  if (password !== undefined && password.length > 0) {
    const forms = [
      password,
      Buffer.from(password, 'utf8').toString('base64'),
      Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString(
        'base64',
      ),
    ];
    // Longest first, so a form that contains another is replaced as a whole.
    for (const form of forms.sort((a, b) => b.length - a.length)) {
      out = out.split(form).join(REDACTED);
    }
  }
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH - 1)}…` : out;
}
