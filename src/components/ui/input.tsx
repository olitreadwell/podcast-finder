/**
 * Styled native text input. Radix has no input primitive, so inputs stay
 * native but share one style so every form looks consistent.
 *
 * @param props - Native input props
 * @returns A styled input element
 */
export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={`rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-400 dark:focus:ring-neutral-700 ${className}`}
      {...props}
    />
  );
}
import type { ComponentProps } from 'react';
