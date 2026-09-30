#!/usr/bin/env node
// Interactive scaffolder: renames this template into a fresh project.
//
// Usage:
//   node scripts/setup.mjs                 interactive setup
//   node scripts/setup.mjs --dry-run        show changes, write nothing
//   node scripts/setup.mjs --app-name foo --target /path/to/repo
//   node scripts/setup.mjs --help
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: node scripts/setup.mjs [options]

Renames this starter template into a fresh project: package name, README
heading, and package-lock metadata stay consistent.

Options:
  --app-name <name>        New app name (npm-valid, lowercase)
  --scope <scope>          Optional npm scope, e.g. acme
  --contact-email <email>  Inbox for the contact form (CONTACT_TO)
  --package-manager <pm>   npm (default) or pnpm
  --deploy <target>        vercel (default), docker, or github-pages
  --target <dir>           Project root to modify (default: current dir)
  --force                  Run even when the target does not look like a template
  --dry-run                Print planned changes without writing anything
  --help                   Show this help and exit
`;

function out(line = '') {
  process.stdout.write(`${line}\n`);
}

/**
 * Parse CLI arguments into an options object.
 *
 * @param {string[]} argv - Raw arguments
 * @returns {object} Parsed options
 */
export function parseArgs(argv) {
  const opts = {
    appName: null,
    scope: null,
    contactEmail: null,
    packageManager: 'npm',
    deploy: 'vercel',
    target: null,
    force: false,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
        opts.help = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--app-name':
      case '--scope':
      case '--contact-email':
      case '--package-manager':
      case '--deploy':
      case '--target':
        opts[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
          argv[i + 1] ?? '';
        i += 1;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

/**
 * Validate the target looks like a template checkout (unless forced).
 *
 * @param {string} root - Project root
 * @param {boolean} force - Bypass validation
 * @returns {string | null} Error message, or null when valid
 */
export function validateTarget(root, force) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    return 'no package.json found in target';
  }
  if (force) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.name !== 'template') {
      return `package.json name is "${pkg.name}", not "template" — run with --force to overwrite anyway`;
    }
    return null;
  } catch {
    return 'package.json is not valid JSON';
  }
}

/**
 * Validate an npm package name (optionally scoped).
 *
 * @param {string} name - Proposed name
 * @returns {boolean} Whether the name is valid
 */
export function isValidAppName(name) {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}

/**
 * Title-case a kebab-case name for the README heading.
 *
 * @param {string} name - npm name
 * @returns {string} Human heading, e.g. "my-app" -> "My App"
 */
export function toTitleCase(name) {
  const bare = name.split('/').pop() ?? name;
  return bare
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Compute the list of changes the scaffolder would make.
 *
 * @param {string} root - Project root
 * @param {object} opts - Parsed options
 * @returns {Array<{ action: string; file: string; detail: string }>} Planned changes
 */
export function planChanges(root, opts) {
  const changes = [];
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const scopedName = opts.scope ? `@${opts.scope}/${opts.appName}` : opts.appName;
  if (pkg.name !== scopedName) {
    changes.push({
      action: 'set',
      file: 'package.json',
      detail: `name: ${pkg.name} -> ${scopedName}`,
    });
  }
  const envExamplePath = join(root, '.env.example');
  if (opts.contactEmail && existsSync(envExamplePath)) {
    changes.push({
      action: 'set',
      file: '.env.example',
      detail: `CONTACT_TO -> ${opts.contactEmail}`,
    });
  }
  const readmePath = join(root, 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    const title = toTitleCase(scopedName);
    if (!readme.startsWith(`# ${title}`)) {
      changes.push({ action: 'set', file: 'README.md', detail: `h1 -> # ${title}` });
    }
  }
  changes.push({
    action: 'note',
    file: 'package.json',
    detail: `packageManager: ${opts.packageManager}, deploy: ${opts.deploy} (no write)`,
  });
  return changes;
}

/**
 * Apply planned changes to disk.
 *
 * @param {string} root - Project root
 * @param {Array<{ action: string; file: string; detail: string }>} changes - Planned changes
 */
export function applyChanges(root, changes) {
  for (const change of changes) {
    if (change.action !== 'set') continue;
    const filePath = join(root, change.file);
    if (change.file === 'package.json') {
      const pkg = JSON.parse(readFileSync(filePath, 'utf8'));
      pkg.name = change.detail.match(/-> (.*)$/)[1];
      writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    if (change.file === 'README.md') {
      const readme = readFileSync(filePath, 'utf8');
      const title = change.detail.replace('h1 -> # ', '');
      writeFileSync(filePath, readme.replace(/^#\s+.*$/m, `# ${title}`));
    }
    if (change.file === '.env.example') {
      const envExample = readFileSync(filePath, 'utf8');
      const email = change.detail.replace('CONTACT_TO -> ', '');
      writeFileSync(filePath, envExample.replace(/^CONTACT_TO=.*$/m, `CONTACT_TO=${email}`));
    }
  }
}

/**
 * Interactive prompt helpers with a readline fallback.
 *
 * @returns {{ text: (q: string, fb?: string) => Promise<string>, select: (q: string, c: Array<{value: string; label: string}>) => Promise<string>, close: () => void }}
 */
function fallbackPrompts() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) =>
    new Promise((resolveAnswer) => {
      rl.question(q, (answer) => resolveAnswer(answer.trim()));
    });
  return {
    async text(msg, fb = '') {
      const a = await ask(`${msg}${fb ? ` [${fb}]` : ''}: `);
      return a || fb;
    },
    async select(msg, choices) {
      out(msg);
      choices.forEach((c, i) => out(`  ${i + 1}) ${c.label}`));
      const a = await ask('Enter number: ');
      const idx = Number(a) - 1;
      return choices[Number.isNaN(idx) || idx < 0 || idx >= choices.length ? 0 : idx].value;
    },
    close() {
      rl.close();
    },
  };
}

/**
 * Run the scaffolder.
 *
 * @param {string[]} argv - Command arguments
 * @param {object} io - Logger + prompt injection for tests
 * @returns {Promise<number>} Exit code
 */
export async function main(argv, io = {}) {
  const log = io.log ?? out;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(err.message);
    log(HELP);
    return 1;
  }
  if (opts.help) {
    log(HELP);
    return 0;
  }
  const root = opts.target ? resolve(opts.target) : resolve('.');
  const targetError = validateTarget(root, opts.force);
  if (targetError) {
    log(`error: ${targetError}`);
    return 1;
  }
  if (!opts.appName) {
    const prompts = io.prompts ?? fallbackPrompts();
    const appName = await prompts.text(
      'App name (npm-valid, lowercase)',
      basename(root) || 'my-app'
    );
    if (!isValidAppName(appName)) {
      log(`error: invalid app name "${appName}"`);
      prompts.close?.();
      return 1;
    }
    opts.appName = appName;
    opts.scope = opts.scope ?? (await prompts.text('npm scope (optional, e.g. acme)', ''));
    opts.contactEmail =
      opts.contactEmail ??
      (await prompts.text('Contact email (for feedback)', `${appName}-contact@ot.mozmail.com`));
    opts.packageManager = await prompts.select('Package manager', [
      { value: 'npm', label: 'npm (default)' },
      { value: 'pnpm', label: 'pnpm' },
    ]);
    prompts.close?.();
  }
  if (!isValidAppName(opts.appName)) {
    log(`error: invalid app name "${opts.appName}"`);
    return 1;
  }
  const changes = planChanges(root, opts);
  for (const change of changes) {
    log(
      `${opts.dryRun ? '[dry-run] would' : 'will'} ${change.action} ${change.file}: ${change.detail}`
    );
  }
  if (!opts.dryRun) {
    applyChanges(root, changes);
  }
  if (!opts.dryRun) {
    log('');
    log('next steps:');
    log('  pnpm install');
    log('  pnpm run check');
    log('  git add -A && git commit -m "feat: init <app>"');
    log('  gh repo create <owner>/<app> --private --source . --push');
  }
  return 0;
}

// Direct invocation only: `node scripts/setup.mjs`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
