// A small query language for the results list: `AND`, `OR`, `NOT`,
// parentheses, quoted phrases, field prefixes, wildcards, and numeric
// comparisons.
//
// It is deliberately hand-written rather than a dependency. The whole grammar
// is one file, it needs no AST library, and it lets the error messages name the
// field the visitor mistyped instead of saying "syntax error".
//
// Matching runs over the shows already on screen. Nothing here fetches: the
// feed reports the numbers come from are the ones the page asked for anyway.

import type { PodcastFeedReport } from './feed-report';
import type { PodcastShow } from './itunes-search';

/** Longest query accepted, so a pasted document cannot become a filter. Kept at
 * the search route's own term cap, so the words a query hands a directory can
 * never be longer than that route accepts. */
export const MAX_QUERY_LENGTH = 120;

/** Text fields a term can be scoped to. */
export const QUERY_TEXT_FIELDS = [
  'title',
  'publisher',
  'genre',
  'country',
  'language',
  'verdict',
] as const;

/** Numeric fields a term can be scoped to, with the report value behind each.
 * `length` is in minutes, because minutes are how a listener thinks about how
 * long an episode takes. `releases` counts the episodes across the feed's year
 * of monthly bars, which is the number the Releases a month cell sorts on. */
export const QUERY_NUMBER_FIELDS = ['gap', 'last', 'episodes', 'length', 'releases'] as const;

/** A text field the query can name. */
export type QueryTextField = (typeof QUERY_TEXT_FIELDS)[number];

/** A numeric field the query can name. */
export type QueryNumberField = (typeof QUERY_NUMBER_FIELDS)[number];

/** Comparison a numeric term can use. */
export type QueryComparison = '>' | '<' | '>=' | '<=' | '=';

/** One node of the parsed query. */
export type PodcastQueryNode =
  | { kind: 'and'; nodes: PodcastQueryNode[] }
  | { kind: 'or'; nodes: PodcastQueryNode[] }
  | { kind: 'not'; node: PodcastQueryNode }
  | { kind: 'text'; field: QueryTextField | null; value: string }
  | { kind: 'number'; field: QueryNumberField; operator: QueryComparison; value: number };

/** Result of parsing: a tree, no tree for an empty query, or a sentence. */
export type PodcastQueryParseResult =
  { ok: true; node: PodcastQueryNode | null } | { ok: false; reason: string };

/** One show plus the verdict measured for it, which is what a query reads. */
export interface PodcastQuerySubject {
  /** The show as Apple described it. */
  show: PodcastShow;
  /** The feed report for that show, or null when it has not arrived or failed. */
  report: PodcastFeedReport | null;
}

/** A token, once quoting has been stripped and folded into the value. */
type QueryToken =
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'term'; raw: string };

/** Human wording for the operator a visitor typed. */
const COMPARISON_LABELS: Record<string, QueryComparison> = {
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '=': '=',
};

function isTextfield(value: string): value is QueryTextField {
  return (QUERY_TEXT_FIELDS as readonly string[]).includes(value);
}

function isNumberField(value: string): value is QueryNumberField {
  return (QUERY_NUMBER_FIELDS as readonly string[]).includes(value);
}

/**
 * Split a query into parentheses, the three keywords, and terms.
 *
 * Quoted runs keep their spaces and are never read as keywords, so
 * `publisher:"Pipe Media"` is one term and a title of `and` can still be found
 * by quoting it.
 */
function tokeniseQuery(
  query: string
): { ok: true; tokens: QueryToken[] } | { ok: false; reason: string } {
  const tokens: QueryToken[] = [];
  let index = 0;

  while (index < query.length) {
    const char = query[index];
    if (char === undefined) break;

    if (char === ' ' || char === '\t' || char === '\n') {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index += 1;
      continue;
    }

    let raw = '';
    let quoted = false;
    while (index < query.length) {
      const current = query[index];
      if (current === undefined) break;
      if (current === '"') {
        quoted = true;
        index += 1;
        const closing = query.indexOf('"', index);
        if (closing === -1) return { ok: false, reason: 'A quote is not closed.' };
        raw += query.slice(index, closing);
        index = closing + 1;
        continue;
      }
      if (current === ' ' || current === '\t' || current === '\n') break;
      if (current === '(' || current === ')') break;
      raw += current;
      index += 1;
    }

    if (raw === '') return { ok: false, reason: 'There is an empty term in that query.' };
    if (!quoted && raw.toLowerCase() === 'and') tokens.push({ kind: 'and' });
    else if (!quoted && raw.toLowerCase() === 'or') tokens.push({ kind: 'or' });
    else if (!quoted && raw.toLowerCase() === 'not') tokens.push({ kind: 'not' });
    else tokens.push({ kind: 'term', raw });
  }

  return { ok: true, tokens };
}

/** Turn one term into a node, or explain which field or number is wrong. */
function buildTermNode(raw: string): PodcastQueryParseResult {
  // `gap>30` and `gap:>30` both mean the same thing, because a comparison
  // reads naturally without the colon and a visitor types whichever comes out.
  const comparison = new RegExp(
    `^(${QUERY_NUMBER_FIELDS.join('|')})\\s*(>=|<=|>|<|=)\\s*(-?\\d+(?:\\.\\d+)?)$`,
    'i'
  ).exec(raw);
  if (comparison !== null) {
    const field = (comparison[1] ?? '').toLowerCase();
    const operator = COMPARISON_LABELS[comparison[2] ?? ''] ?? '=';
    const value = Number(comparison[3]);
    if (isNumberField(field) && Number.isFinite(value)) {
      return { ok: true, node: { kind: 'number', field, operator, value } };
    }
  }

  const colon = raw.indexOf(':');
  if (colon === -1) return { ok: true, node: { kind: 'text', field: null, value: raw } };

  const field = raw.slice(0, colon).trim().toLowerCase();
  const rest = raw.slice(colon + 1).trim();
  if (rest === '') return { ok: false, reason: `\`${field}:\` needs a value after it.` };

  if (isTextfield(field)) return { ok: true, node: { kind: 'text', field, value: rest } };

  if (isNumberField(field)) {
    const match = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(rest);
    if (match === null) {
      return { ok: false, reason: `\`${field}:\` wants a number, as in \`${field}>30\`.` };
    }
    const operator = COMPARISON_LABELS[match[1] ?? ''] ?? '=';
    const value = Number(match[2]);
    return { ok: true, node: { kind: 'number', field, operator, value } };
  }

  return {
    ok: false,
    reason: `There is no \`${field}\` field. Try ${[...QUERY_TEXT_FIELDS, ...QUERY_NUMBER_FIELDS].join(', ')}.`,
  };
}

/** Parser state, so the recursive descent can share one cursor. */
interface ParserState {
  tokens: QueryToken[];
  index: number;
}

/**
 * Parse a query into a tree.
 *
 * Precedence is `NOT`, then `AND`, then `OR`, and two terms side by side mean
 * `AND`, so `water npr` reads the way a visitor expects. An empty query is not
 * an error: it matches everything, which is what an untouched filter box means.
 */
export function parsePodcastQuery(query: string): PodcastQueryParseResult {
  const trimmed = query.trim();
  if (trimmed === '') return { ok: true, node: null };
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { ok: false, reason: `Queries are capped at ${MAX_QUERY_LENGTH} characters.` };
  }

  const tokenised = tokeniseQuery(trimmed);
  if (!tokenised.ok) return tokenised;

  const state: ParserState = { tokens: tokenised.tokens, index: 0 };

  const parsePrimary = (): PodcastQueryParseResult | null => {
    const token = state.tokens[state.index];
    if (token === undefined) return null;

    if (token.kind === 'lparen') {
      state.index += 1;
      const inner = parseOr();
      if (!inner.ok) return inner;
      if (inner.node === null)
        return { ok: false, reason: 'There is an empty group of parentheses.' };
      const closing = state.tokens[state.index];
      if (closing === undefined || closing.kind !== 'rparen') {
        return { ok: false, reason: 'A bracket is not closed.' };
      }
      state.index += 1;
      return { ok: true, node: inner.node };
    }

    if (token.kind === 'term') {
      state.index += 1;
      return buildTermNode(token.raw);
    }

    if (token.kind === 'rparen') {
      return { ok: false, reason: 'There is an empty group of parentheses.' };
    }
    return { ok: false, reason: 'A keyword is missing the term it applies to.' };
  };

  const parseNot = (): PodcastQueryParseResult => {
    const token = state.tokens[state.index];
    if (token !== undefined && token.kind === 'not') {
      state.index += 1;
      const inner = parseNot();
      if (!inner.ok) return inner;
      if (inner.node === null) return { ok: false, reason: '`NOT` needs a term after it.' };
      return { ok: true, node: { kind: 'not', node: inner.node } };
    }
    const primary = parsePrimary();
    return primary ?? { ok: true, node: null };
  };

  const parseAnd = (): PodcastQueryParseResult => {
    const first = parseNot();
    if (!first.ok) return first;
    const nodes = first.node === null ? [] : [first.node];

    for (;;) {
      const token = state.tokens[state.index];
      if (token === undefined) break;
      if (token.kind === 'or' || token.kind === 'rparen') break;
      const explicitAnd = token.kind === 'and';
      if (explicitAnd) state.index += 1;
      const next = parseNot();
      if (!next.ok) return next;
      if (next.node === null) {
        if (explicitAnd) return { ok: false, reason: '`AND` needs a term after it.' };
        break;
      }
      nodes.push(next.node);
    }

    if (nodes.length === 0) return { ok: true, node: null };
    if (nodes.length === 1) return { ok: true, node: nodes[0] ?? null };
    return { ok: true, node: { kind: 'and', nodes } };
  };

  const parseOr = (): PodcastQueryParseResult => {
    const first = parseAnd();
    if (!first.ok) return first;
    const nodes = first.node === null ? [] : [first.node];

    while (state.tokens[state.index]?.kind === 'or') {
      state.index += 1;
      const next = parseAnd();
      if (!next.ok) return next;
      if (next.node === null) return { ok: false, reason: '`OR` needs a term after it.' };
      nodes.push(next.node);
    }

    if (nodes.length === 0) return { ok: true, node: null };
    if (nodes.length === 1) return { ok: true, node: nodes[0] ?? null };
    return { ok: true, node: { kind: 'or', nodes } };
  };

  const parsed = parseOr();
  if (!parsed.ok) return parsed;
  const trailing = state.tokens[state.index];
  if (trailing !== undefined) {
    return {
      ok: false,
      reason:
        trailing.kind === 'rparen' ? 'A bracket is closed twice.' : 'The query ends in a keyword.',
    };
  }
  return parsed;
}

/**
 * Whether one haystack contains the query value, treating `*` as any run of
 * characters and `?` as one. Everything else in the value is a literal, so a
 * visitor cannot paste a pattern that backtracks forever.
 */
export function matchesTextQuery(haystack: string, value: string): boolean {
  const pattern = value
    .replace(/[.*+?^${}()|[\]\\]/g, (char) => (char === '*' || char === '?' ? char : `\\${char}`))
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(pattern, 'i').test(haystack);
}

/**
 * The text a term without a field is matched against.
 *
 * A directory matches more than the fields it hands back, so the feed's own
 * description and newest episode title are included once it has answered: a
 * topic word that only ever appeared in the show notes would otherwise be
 * filtered out of a result the directory rightly returned.
 */
function readSearchableText(subject: PodcastQuerySubject): string {
  return [
    subject.show.title,
    subject.show.publisher,
    subject.show.genres.join(' '),
    subject.report?.description ?? '',
    subject.report?.latestEpisodeTitle ?? '',
  ].join(' ');
}

/** The text in one named field. */
function readFieldText(subject: PodcastQuerySubject, field: QueryTextField): string {
  switch (field) {
    case 'title':
      return subject.show.title;
    case 'publisher':
      return subject.show.publisher;
    case 'genre':
      return subject.show.genres.join(' ');
    case 'country':
      return subject.show.country;
    case 'language':
      return subject.report?.language ?? '';
    case 'verdict':
      return subject.report?.health ?? 'unknown';
  }
}

/** The number in one named field, or null when the report has not answered. */
function readFieldNumber(subject: PodcastQuerySubject, field: QueryNumberField): number | null {
  const cadence = subject.report?.cadence ?? null;
  if (cadence === null) return null;
  switch (field) {
    case 'gap':
      return cadence.medianGapDays;
    case 'last':
      return cadence.daysSinceLastEpisode;
    case 'episodes':
      return cadence.datedEpisodeCount;
    case 'length':
      return cadence.medianDurationSeconds === null
        ? null
        : Math.round(cadence.medianDurationSeconds / 60);
    case 'releases':
      return cadence.monthlyReleaseCounts.reduce((total, count) => total + count, 0);
  }
}

/** Compare two numbers with the operator a visitor typed. */
function compareNumbers(actual: number, operator: QueryComparison, expected: number): boolean {
  switch (operator) {
    case '>':
      return actual > expected;
    case '<':
      return actual < expected;
    case '>=':
      return actual >= expected;
    case '<=':
      return actual <= expected;
    case '=':
      return actual === expected;
  }
}

/**
 * Whether one show satisfies a parsed query.
 *
 * A numeric term needs an answered feed: a show whose report has not arrived
 * yet cannot be said to have published 30 days ago, so it does not match. That
 * keeps the list from filling with shows that merely have not answered.
 */
export function matchesPodcastQuery(node: PodcastQueryNode, subject: PodcastQuerySubject): boolean {
  switch (node.kind) {
    case 'and':
      return node.nodes.every((child) => matchesPodcastQuery(child, subject));
    case 'or':
      return node.nodes.some((child) => matchesPodcastQuery(child, subject));
    case 'not':
      return !matchesPodcastQuery(node.node, subject);
    case 'text': {
      const haystack =
        node.field === null ? readSearchableText(subject) : readFieldText(subject, node.field);
      return matchesTextQuery(haystack, node.value);
    }
    case 'number': {
      const actual = readFieldNumber(subject, node.field);
      return actual !== null && compareNumbers(actual, node.operator, node.value);
    }
  }
}

/**
 * The words to send to a directory, taken out of a parsed query.
 *
 * The box holds one language, but a directory search only understands a set of
 * words, so this takes the positive ones and leaves the rest to the local
 * matcher: `water AND NOT verdict:dead` searches `water` and filters the rest,
 * and a query of nothing but `gap>30` searches nothing at all.
 *
 * Fields that name a fixed vocabulary rather than a topic (`verdict`,
 * `language`, `country`) are kept out of the directory term as well, so
 * `science language:en` searches for science and filters the language, instead
 * of asking every directory for shows about `science en`.
 *
 * Words inside a `NOT` are skipped, because asking Apple for a show and then
 * discarding it wastes the one request the app makes per search. Wildcards are
 * stripped rather than sent, and a word shorter than two characters is dropped
 * because no directory search accepts one.
 */
export function extractPodcastSearchTerm(node: PodcastQueryNode | null): string {
  if (node === null) return '';

  /** Minimum a directory will accept as a search term. */
  const MINIMUM_TERM_LENGTH = 2;

  const collect = (current: PodcastQueryNode, negated: boolean): string[] => {
    switch (current.kind) {
      case 'and':
      case 'or':
        return current.nodes.flatMap((child) => collect(child, negated));
      case 'not':
        return collect(current.node, true);
      case 'number':
        return [];
      case 'text': {
        if (negated) return [];
        // These three name a fixed vocabulary rather than a topic, so they
        // filter locally and are never sent to a directory.
        if (
          current.field === 'verdict' ||
          current.field === 'language' ||
          current.field === 'country'
        ) {
          return [];
        }
        const words = current.value.replace(/[*?]/g, '').trim();
        return words.length >= MINIMUM_TERM_LENGTH ? [words] : [];
      }
    }
  };

  return collect(node, false).join(' ').slice(0, MAX_QUERY_LENGTH);
}
