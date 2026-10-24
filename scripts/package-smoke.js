'use strict';

// Exercise the actual npm tarball, not a link to the checkout. No model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-package-'));
const evidence = path.join(root, 'evidence');
fs.mkdirSync(evidence);
console.log(`Evidence directory: ${evidence}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `evidence=${evidence}\n`);
const env = { ...process.env, PI_CODING_AGENT_DIR: path.join(root, 'agent'), PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' };

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024, ...options });
  fs.writeFileSync(path.join(evidence, `${label}.log`), (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : ''));
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 0, `${label}: ${result.error || `exit ${result.status}, signal ${result.signal}`}`);
  return result.stdout;
}

function main() {
  assert.ok(process.env.npm_execpath, 'Run with npm run test:package');
  const npm = (label, args) => run(label, process.execPath, [process.env.npm_execpath, ...args]);
  const packed = JSON.parse(npm('pack', ['pack', '--json', '--pack-destination', evidence]))[0];
  fs.writeFileSync(path.join(evidence, 'package.json'), JSON.stringify(packed, null, 2));
  const prefix = path.join(root, 'installed');
  npm('install', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', path.join(evidence, packed.filename)]);
  const pkg = path.join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', ...packed.name.split('/'));
  for (const file of packed.files) {
    assert.deepEqual(fs.readFileSync(path.join(pkg, file.path)), fs.readFileSync(path.join(repo, file.path)), `installed bytes differ: ${file.path}`);
  }
  assert.ok(!packed.files.some(file => /^(tests|scripts|specs)\//.test(file.path)), 'test resources must not ship');
  const shim = path.join(prefix, ...(process.platform === 'win32' ? [] : ['bin']), process.platform === 'win32' ? 'charterleaf.cmd' : 'charterleaf');
  assert.ok(fs.existsSync(shim), 'npm must install the CLI entry point');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'specs/capabilities'), { recursive: true });
  fs.writeFileSync(path.join(project, 'specs/capabilities/check.md'), '---\nid: package.check\napplies_to:\n  - src/**\n---\n# Package check\n');
  const cli = path.join(pkg, 'bin/charterleaf.js');
  assert.match(run('help', process.execPath, [cli, '--help']), /related <path>/);
  assert.match(run('related', process.execPath, [cli, 'related', 'src/check.js'], { cwd: project }), /specs\/capabilities\/check.md/);
  assert.match(run('lint', process.execPath, [cli, 'lint'], { cwd: project }), /0 structural errors/);
  fs.cpSync(path.join(repo, 'tests'), path.join(pkg, 'tests'), { recursive: true });
  run('installed-tests', process.execPath, ['--test'], { cwd: pkg });
  if (process.env.PI_CLI) {
    run('pi-smoke', process.execPath, [path.join(repo, 'scripts/pi-smoke.js')], { env: { ...env, CHARTERLEAF_PACKAGE: pkg } });
  }
  console.log('PASS: actual package install, byte equality, CLI and installed-code tests.');
}

try { main(); }
catch (error) { console.error(error); process.exitCode = 1; }
