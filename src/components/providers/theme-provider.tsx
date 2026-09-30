'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Theme provider: persists the light/dark/system choice and applies the
 * class-based dark variant (see globals.css `@custom-variant dark`).
 * Defaults to the OS preference until the user picks a theme.
 *
 * @param props - Standard next-themes provider props
 * @returns The theme provider wrapping the app
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider attribute="class" defaultTheme="system" enableSystem {...props} />;
}
