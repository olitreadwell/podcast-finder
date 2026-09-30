/** Feedback categories mapped to GitHub labels. */
export type FeedbackType = 'bug' | 'feature' | 'general';

export interface FeedbackInput {
  type: FeedbackType;
  title: string;
  description: string;
  steps?: string;
  expected?: string;
  actual?: string;
  page?: string;
}

export interface FeedbackMeta {
  repo: string;
  userAgent: string;
  appVersion: string;
  reportedAt: string;
}

const LABELS: Record<FeedbackType, string[]> = {
  bug: ['bug'],
  feature: ['enhancement'],
  general: ['question'],
};

/**
 * Build a GitHub issue payload from feedback input plus request context,
 * so reporters submit as much detail as possible with correct labels.
 *
 * @param input - Validated feedback fields
 * @param meta - Request context (repo, UA, version, time)
 * @returns GitHub issues API payload
 */
export function buildIssuePayload(
  input: FeedbackInput,
  meta: FeedbackMeta
): { title: string; body: string; labels: string[] } {
  const title = `${input.title} (${input.type})`;
  const sections = ['## Summary', input.description];
  if (input.type === 'bug') {
    sections.push(
      '## Steps to reproduce',
      input.steps || '_not provided_',
      '## Expected',
      input.expected || '_not provided_',
      '## Actual',
      input.actual || '_not provided_'
    );
  }
  sections.push(
    '## Environment',
    `- **App version:** ${meta.appVersion}`,
    `- **Page:** ${input.page || '_not provided_'}`,
    `- **User agent:** ${meta.userAgent}`,
    `- **Reported at:** ${meta.reportedAt}`,
    `- **Reported via:** feedback form (${meta.repo})`
  );
  return { title, body: sections.join('\n\n'), labels: LABELS[input.type] };
}
