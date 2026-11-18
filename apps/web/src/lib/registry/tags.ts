/** The generated tag for number `n`: category prefix plus a zero-padded counter (`AT-00042`). */
export function formatTag(prefix: string | null | undefined, n: number): string {
  return `${prefix ?? ''}${String(n).padStart(5, '0')}`;
}
