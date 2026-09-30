import { ThemeToggle } from '@/components/ui/theme-toggle';

/**
 * App header: skip link plus the theme switcher, sticky on every page.
 *
 * @returns The site header
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-neutral-50/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-neutral-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-2xl items-center justify-end px-6 py-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
