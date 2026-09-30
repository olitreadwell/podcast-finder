import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PodcastFinderPage from './page';

/** One show in the shape the search route returns it. */
function wireShow(overrides: Record<string, unknown> = {}) {
  return {
    appleId: 1,
    title: 'Live Drains',
    publisher: 'Drain Media',
    feedUrl: 'https://example.com/live.xml',
    genres: ['Society & Culture'],
    country: 'US',
    artworkUrl: null,
    appleUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 120,
    latestReleaseAt: '2025-12-22T09:00:00.000Z',
    explicit: false,
    ...overrides,
  };
}

/** One report in the shape the status route returns it. */
function report(overrides: Record<string, unknown> = {}) {
  return {
    feedUrl: 'https://example.com/live.xml',
    ok: true,
    reason: null,
    feedTitle: 'Live Drains',
    description: 'A weekly look at drains.',
    latestEpisodeTitle: 'Episode 120',
    health: 'active',
    claim: null,
    claimMismatch: null,
    cadence: {
      datedEpisodeCount: 120,
      lastEpisodeAt: '2025-12-22T09:00:00.000Z',
      daysSinceLastEpisode: 3,
      medianGapDays: 7,
      gapSpreadDays: 1,
      episodesInLast30Days: 4,
      episodesInLast90Days: 13,
      episodesInLast365Days: 52,
      medianDurationSeconds: 2880,
      monthlyReleaseCounts: new Array(12).fill(4),
    },
    ...overrides,
  };
}

/** A dead show: still promising weekly episodes, silent for over a year. */
function deadReport() {
  return report({
    feedUrl: 'https://example.com/dead.xml',
    feedTitle: 'Dead Drains',
    health: 'dead',
    claim: { label: 'weekly', expectedGapDays: 7, phrase: 'every monday' },
    claimMismatch: {
      direction: 'slower',
      sentence: 'Says weekly, actually every ~400 days',
    },
    cadence: {
      ...report().cadence,
      daysSinceLastEpisode: 400,
      episodesInLast30Days: 0,
      episodesInLast90Days: 0,
      episodesInLast365Days: 0,
    },
  });
}

/** A fetch stand-in the page can call for search and status. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

/** Route the page's two calls to canned answers. */
function stubRoutes(options: {
  shows: unknown[];
  reports?: unknown[];
  searchStatus?: number;
  searchError?: string;
  statusStatus?: number;
  statusError?: string;
}) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/podcast-search')) {
      if (options.searchStatus !== undefined && options.searchStatus >= 400) {
        return jsonResponse({ error: options.searchError ?? 'nope' }, options.searchStatus);
      }
      return jsonResponse({ shows: options.shows });
    }
    if (url.includes('/api/podcast-status')) {
      if (options.statusStatus !== undefined && options.statusStatus >= 400) {
        return jsonResponse({ error: options.statusError ?? 'nope' }, options.statusStatus);
      }
      return jsonResponse({ reports: options.reports ?? [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** Type a topic and wait for the first card. */
async function searchFor(topic: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Topic'), topic);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
  return user;
}

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});

describe('PodcastFinderPage', () => {
  it('renders the heading, the explanation and a link back to the scratchpad', () => {
    render(<PodcastFinderPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Podcast Finder' })).toBeTruthy();
    expect(screen.getByText(/whether they still publish/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /scratchpad/i }).getAttribute('href')).toBe(
      'https://scratchpad-ashen.vercel.app/'
    );
  });

  it('offers example topics before anything is typed', () => {
    render(<PodcastFinderPage />);

    expect(screen.getByRole('button', { name: 'municipal water' })).toBeTruthy();
  });

  it('searches a topic and labels a dead show with its broken promise', async () => {
    stubRoutes({
      shows: [
        wireShow(),
        wireShow({ appleId: 2, title: 'Dead Drains', feedUrl: 'https://example.com/dead.xml' }),
      ],
      reports: [report(), deadReport()],
    });
    render(<PodcastFinderPage />);
    const user = userEvent.setup();

    // Keep the dead show on screen so its badges can be read: with the default
    // filter on, it is hidden the moment its verdict arrives.
    await user.click(screen.getByLabelText(/hide shows that stopped publishing/i));
    await searchFor('drains');

    expect(await screen.findByText('Dead Drains', undefined, { timeout: 2000 })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Dead')).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText('Says weekly, actually every ~400 days')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('hides dormant and dead shows by default and says how many', async () => {
    stubRoutes({
      shows: [
        wireShow(),
        wireShow({ appleId: 2, title: 'Dead Drains', feedUrl: 'https://example.com/dead.xml' }),
      ],
      reports: [report(), deadReport()],
    });
    render(<PodcastFinderPage />);

    await searchFor('drains');
    await screen.findByText('Live Drains');

    await waitFor(() => expect(screen.queryByText('Dead Drains')).toBeNull());
    expect(screen.getByText(/1 dormant or dead shows hidden/)).toBeTruthy();
  });

  it('shows the dead shows again when the box is unticked', async () => {
    stubRoutes({
      shows: [
        wireShow({ appleId: 2, title: 'Dead Drains', feedUrl: 'https://example.com/dead.xml' }),
      ],
      reports: [deadReport()],
    });
    render(<PodcastFinderPage />);

    const user = await searchFor('drains');
    await waitFor(() => expect(screen.queryByText('Dead Drains')).toBeNull());

    await user.click(screen.getByLabelText(/hide shows that stopped publishing/i));

    expect(await screen.findByText('Dead Drains')).toBeTruthy();
  });

  it('reports a failed search in plain words', async () => {
    stubRoutes({ shows: [], searchStatus: 502, searchError: 'Apple answered 429.' });
    render(<PodcastFinderPage />);

    await searchFor('drains');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Apple answered 429.')).toBeTruthy();
  });

  it('keeps Apple’s numbers and says so when feeds cannot be checked', async () => {
    stubRoutes({
      shows: [wireShow({ latestReleaseAt: '2025-12-22T09:00:00.000Z' })],
      statusStatus: 400,
      statusError: 'Send between 1 and 20 feed URLs.',
    });
    render(<PodcastFinderPage />);

    await searchFor('drains');

    expect(await screen.findByText(/Feeds could not be checked/)).toBeTruthy();
    expect(screen.getByText('Live Drains')).toBeTruthy();
    expect(screen.getByText('Episodes')).toBeTruthy();
  });

  it('says when a show has no feed to check', async () => {
    stubRoutes({ shows: [wireShow({ feedUrl: null })], reports: [] });
    render(<PodcastFinderPage />);

    await searchFor('drains');

    expect(await screen.findByText(/Apple returned no feed URL/)).toBeTruthy();
  });

  it('says when nothing matched', async () => {
    stubRoutes({ shows: [], reports: [] });
    render(<PodcastFinderPage />);

    await searchFor('drains');

    expect(await screen.findByText('No shows matched that topic.')).toBeTruthy();
  });

  it('searches the chosen storefront and genre', async () => {
    stubRoutes({ shows: [wireShow()], reports: [report()] });
    render(<PodcastFinderPage />);

    const user = await searchFor('drains');
    await screen.findByText('Live Drains');

    await user.selectOptions(screen.getByLabelText('Storefront'), 'nz');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('country=nz'))).toBe(true);
    });
  });
});
