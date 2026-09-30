import { expect, test } from '@playwright/test';

test('security headers are set on app pages', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('geolocation=()');
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  // Artwork comes from whichever host a directory names, so https stays
  // allowed or the cover art silently stops loading.
  expect(headers['content-security-policy']).toContain("img-src 'self' data: blob: https:");
});

test('docs page gets the looser CSP that allows unpkg', async ({ request }) => {
  const response = await request.get('/docs');
  expect(response.status()).toBe(200);
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain('https://unpkg.com');
});

test('sitemap lists the public pages', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('<loc>');
  expect(body).toContain('/contact');
  expect(body).not.toContain('/login');
});

test('unknown routes render the custom 404 page', async ({ page }) => {
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the homepage' })).toHaveAttribute(
    'href',
    '/'
  );
});

test('favicon is served', async ({ request }) => {
  const response = await request.get('/icon.svg');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
});

test('manifest, service worker, and llms.txt are served', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()['content-type']).toContain('json');
  const manifestBody = await manifest.json();
  expect(manifestBody.start_url).toBe('/');
  expect(manifestBody.display).toBe('standalone');

  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain('podcast-finder-shell-v1');

  const llms = await request.get('/llms.txt');
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toContain('# Podcast Finder');
});

test('homepage declares hreflang and manifest links', async ({ page }) => {
  await page.goto('/');
  const hreflangEn = page.locator('link[rel="alternate"][hreflang="en"]');
  await expect(hreflangEn).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
  const hreflangDefault = page.locator('link[rel="alternate"][hreflang="x-default"]');
  await expect(hreflangDefault).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest'
  );
});

test('docs page preconnects to unpkg', async ({ page }) => {
  await page.goto('/docs');
  const preconnect = page.locator('link[rel="preconnect"][href="https://unpkg.com"]');
  await expect(preconnect).toHaveAttribute('crossorigin', '');
});
