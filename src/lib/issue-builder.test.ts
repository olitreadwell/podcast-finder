import { describe, expect, it } from 'vitest';
import { buildIssuePayload } from '@/lib/issue-builder';

const meta = {
  repo: 'acme/app',
  userAgent: 'test-agent',
  appVersion: '0.1.0',
  reportedAt: '2026-08-26T00:00:00Z',
};

describe('buildIssuePayload', () => {
  it('labels bug reports as bug with full detail', () => {
    const payload = buildIssuePayload(
      {
        type: 'bug',
        title: 'Crash on load',
        description: 'App crashes',
        steps: '1. Open',
        expected: 'Loads',
        actual: 'Crashes',
        page: '/home',
      },
      meta
    );
    expect(payload.labels).toEqual(['bug']);
    expect(payload.title).toBe('Crash on load (bug)');
    expect(payload.body).toContain('## Steps to reproduce');
    expect(payload.body).toContain('test-agent');
    expect(payload.body).toContain('/home');
  });

  it('labels feature requests as enhancement', () => {
    const payload = buildIssuePayload(
      { type: 'feature', title: 'Add export', description: 'Want CSV' },
      meta
    );
    expect(payload.labels).toEqual(['enhancement']);
    expect(payload.body).not.toContain('## Steps to reproduce');
  });

  it('falls back to placeholders for missing detail', () => {
    const payload = buildIssuePayload({ type: 'bug', title: 'x', description: 'y' }, meta);
    expect(payload.body).toContain('_not provided_');
  });
});
