/** The editor's text as JSON, or `undefined` when it is not JSON at all (checked before the API). */
export function parseSpecText(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/**
 * A starting point the user completes: the file's columns as the fingerprint, the parts to fill
 * left empty (the API's issues then say exactly what is missing).
 */
export function skeleton(fileName: string, headers: readonly string[]) {
  return {
    format: 'lazy-koins-mapping',
    version: 1,
    name: fileName.replace(/\.[^.]+$/, '') || 'Neues Mapping',
    platform: '',
    match: { headers: [...headers] },
    bookings: {
      timestamp: { column: '', format: 'ymd', timeZone: 'UTC' },
      account: { value: 'main' },
      asset: { column: '' },
      quantity: { mode: 'signed', column: '' },
      kind: { columns: [''], rules: [], default: 'unknown' },
    },
  };
}
