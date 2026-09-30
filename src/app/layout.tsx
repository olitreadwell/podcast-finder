import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/site-header';
import { ServiceWorkerRegister } from '@/components/providers/service-worker-register';
import { ThemeProvider } from '@/components/providers/theme-provider';
import './globals.css';

// Deploys set NEXT_PUBLIC_SITE_URL; the localhost default keeps canonical
// and sitemap URLs valid in dev and in the smoke/e2e gates.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Podcast Finder',
  description:
    'Search Apple\u2019s podcast directory, then check whether each show still publishes.',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
    // English-only site; x-default points at the same URL so crawlers and
    // browsers know there is no localized variant to prefer.
    languages: { en: '/', 'x-default': '/' },
  },
  openGraph: {
    title: 'Podcast Finder',
    description:
      'Search Apple\u2019s podcast directory, then check whether each show still publishes.',
    url: '/',
    siteName: 'Podcast Finder',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Podcast Finder',
    description:
      'Search Apple\u2019s podcast directory, then check whether each show still publishes.',
  },
};

/**
 * Root layout: wraps every route in the HTML shell with theming.
 * `suppressHydrationWarning` lets next-themes set the theme class on
 * <html> without a hydration mismatch warning.
 *
 * @param props - Layout props
 * @param props.children - Rendered route content
 * @returns The root HTML document
 */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SiteHeader />
          {children}
          <ServiceWorkerRegister />
          <noscript>
            <p className="px-6 py-2 text-sm text-neutral-600 dark:text-neutral-400">
              JavaScript is off. Pages render, but the contact and feedback forms need it.
            </p>
          </noscript>
        </ThemeProvider>
      </body>
    </html>
  );
}
