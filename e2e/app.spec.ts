import { expect, test } from '@playwright/test';

test('homepage renders and health answers', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Podcast Finder' })).toBeVisible();

  const health = await request.get('/health');
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: 'ok' });
});

test('openapi spec is served and swagger ui renders', async ({ page, request }) => {
  const spec = await request.get('/api/openapi.json');
  expect(spec.status()).toBe(200);
  const body = (await spec.json()) as { openapi: string; paths: Record<string, unknown> };
  expect(body.openapi).toBe('3.1.0');
  expect(body.paths['/api/hello']).toBeDefined();

  await page.goto('/docs');
  await expect(page.locator('.swagger-ui .info .title')).toContainText('Podcast Finder API', {
    timeout: 15_000,
  });
  await expect(page.locator('.swagger-ui .opblock')).toHaveCount(7);
});
