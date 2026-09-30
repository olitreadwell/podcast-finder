import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const SETUP_SCRIPT = fileURLToPath(new URL('./setup.mjs', import.meta.url));

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'setup-fixture-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'template', version: '0.1.0', scripts: { dev: 'next dev' } }, null, 2)
  );
  writeFileSync(join(dir, 'README.md'), '# Starter Template\n\nBody text.\n');
  writeFileSync(join(dir, '.env.example'), 'PORT=3000\nCONTACT_TO=placeholder@example.com\n');
  return dir;
}

function run(dir, args) {
  try {
    const stdout = execFileSync(process.execPath, [SETUP_SCRIPT, '--target', dir, ...args], {
      encoding: 'utf8',
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '' };
  }
}

describe('setup.mjs', () => {
  let fixture;
  before(() => {
    fixture = mkdtempSync(join(tmpdir(), 'setup-suite-'));
  });
  after(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it('--help exits 0 and prints usage', () => {
    const { code, stdout } = run(fixture, ['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Usage: node scripts\/setup\.mjs/);
  });

  it('rejects unknown options', () => {
    const { code } = run(fixture, ['--bogus']);
    assert.equal(code, 1);
  });

  it('--dry-run writes nothing', () => {
    const dir = makeFixture();
    const before = readFileSync(join(dir, 'package.json'), 'utf8');
    const { code, stdout } = run(dir, ['--app-name', 'demo-app', '--dry-run']);
    assert.equal(code, 0);
    assert.match(stdout, /\[dry-run\] would/);
    assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
    rmSync(dir, { recursive: true, force: true });
  });

  it('renames package name and README heading', () => {
    const dir = makeFixture();
    const { code } = run(dir, ['--app-name', 'demo-app', '--scope', 'acme']);
    assert.equal(code, 0);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, '@acme/demo-app');
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /^# Demo App$/m);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the contact email into .env.example', () => {
    const dir = makeFixture();
    const { code } = run(dir, [
      '--app-name',
      'demo-app',
      '--contact-email',
      'demo-app-contact@ot.mozmail.com',
    ]);
    assert.equal(code, 0);
    assert.match(
      readFileSync(join(dir, '.env.example'), 'utf8'),
      /CONTACT_TO=demo-app-contact@ot\.mozmail\.com/
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a directory that is not a template checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-nontemplate-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'other' }));
    const { code } = run(dir, ['--app-name', 'x']);
    assert.equal(code, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});
