import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * XML sitemap for the public pages. Login is excluded: auth pages should
 * not be indexed.
 *
 * @returns Sitemap entries for the public routes
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { path: '', priority: 1 },
    { path: '/contact', priority: 0.8 },
    { path: '/feedback', priority: 0.8 },
    { path: '/help', priority: 0.8 },
  ];
  return pages.map((page) => ({
    url: `${siteUrl}${page.path}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: page.priority,
  }));
}
