/**
 * The provider address a user may set. The API itself sends requests to it, so on a shared
 * server a private address would let users probe the server's own network (SSRF). Private and
 * loopback hosts are therefore only allowed where they are the point — the desktop app talks to
 * a local Ollama / LM Studio — or when the operator allows them explicitly
 * (`AI_ALLOW_PRIVATE_URLS`). Checked on the literal host; DNS rebinding is not covered.
 */
export type BaseUrlProblem = 'invalidUrl' | 'privateUrl';

export function checkBaseUrl(
  value: string,
  allowPrivate: boolean,
): BaseUrlProblem | undefined {
  if (value === '') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalidUrl';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'invalidUrl';
  if (url.username || url.password || url.search || url.hash)
    return 'invalidUrl';
  if (!allowPrivate && isPrivateHost(url.hostname)) return 'privateUrl';
  return undefined;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') // single-label names resolve inside the network
  ) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.includes(':')) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:')
    );
  }
  return false;
}
