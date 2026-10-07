/** Files grouped by platform, in order of first appearance (F4.4/F4.4a: "je Plattform/Wallet"). */
export function filesByPlatform<T extends { readonly platform: string | null }>(
  files: readonly T[],
): { platform: string | null; files: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const file of files) {
    groups.set(file.platform, [...(groups.get(file.platform) ?? []), file]);
  }
  return [...groups.entries()].map(([platform, list]) => ({
    platform,
    files: list,
  }));
}
