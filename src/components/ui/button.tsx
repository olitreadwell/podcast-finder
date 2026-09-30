import * as SlotPrimitive from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  /** Render the button styles on a child element (e.g. a Link). */
  asChild?: boolean;
};

/**
 * Button with the shared action styling. Set `asChild` to apply the styles
 * to a Link or other element instead of rendering a `<button>`.
 *
 * @param props - Button props, plus asChild
 * @returns The styled button (or styled child when asChild)
 */
export function Button({ asChild = false, className = '', ...props }: ButtonProps) {
  const Comp = asChild ? SlotPrimitive.Slot : 'button';
  return (
    <Comp
      className={`inline-flex items-center justify-center rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-400 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:focus:ring-neutral-600 ${className}`}
      {...props}
    />
  );
}
