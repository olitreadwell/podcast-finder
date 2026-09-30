import { describe, expect, it } from 'vitest';
import { GET } from '@/app/health/route';

describe('GET /health', () => {
  it('answers 200 ok', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });
});
