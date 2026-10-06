/**
 * Hands a downloaded blob to the browser as a file. Downloads go through `HttpClient` (the
 * bearer token is only added there), so a plain link to the API would arrive unauthenticated.
 */
export function saveBlob(
  document: Document,
  blob: Blob,
  fileName: string,
): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled; revoking synchronously cancels it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The file name from a `Content-Disposition` header (RFC 6266 `filename*` first). */
export function fileNameFrom(
  disposition: string | null,
  fallback: string,
): string {
  if (!disposition) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the plain name
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain?.[1] ?? fallback;
}
