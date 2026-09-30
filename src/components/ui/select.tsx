import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

/**
 * Accessible select built on Radix. Use SelectItem for each option and keep
 * a hidden native input (name/value) in the form so values still submit.
 */
export function Select({ ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />;
}

/** Trigger button that opens the select popover. */
export function SelectTrigger({
  className = '',
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={`flex w-full items-center justify-between rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-400 dark:focus:ring-neutral-700 ${className}`}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="h-4 w-4 text-neutral-500" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** The displayed value inside the trigger. */
export const SelectValue = SelectPrimitive.Value;

/** Popover panel listing the options. */
export function SelectContent({
  className = '',
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={`z-50 max-h-64 overflow-auto rounded border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${className}`}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** A single option inside SelectContent. */
export function SelectItem({
  className = '',
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800 ${className}`}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-neutral-900 dark:text-neutral-100" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
