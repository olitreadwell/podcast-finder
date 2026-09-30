/**
 * Join class names, dropping falsy entries.
 *
 * @param classes - Class name candidates, one per argument.
 * @returns Single space-separated class string.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
