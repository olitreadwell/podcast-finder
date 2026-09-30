'use client';

import { Moon, Monitor, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

type ThemeOption = (typeof themeOptions)[number]['value'];

/**
 * Light/Dark/System theme switcher. Each option is a labelled button with
 * `aria-pressed`, so the current theme is never conveyed by icon alone.
 *
 * @returns A three-option theme toggle
 */
export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const activeTheme: ThemeOption = theme === 'light' || theme === 'dark' ? theme : 'system';

  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1">
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const isActive = activeTheme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => setTheme(option.value)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 ${
              isActive
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
