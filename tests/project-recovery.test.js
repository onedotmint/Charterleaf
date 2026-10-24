'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { CONFIG, modeConfigPath, readMode, saveMode } = require('../lib/project.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'absent-global-config') };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) delete env[key];
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(path.join(root, 'specs'));
  const legacy = path.join(root, CONFIG);
  const body = '{"version":1,"mode":"auto"}\n';
  fs.writeFileSync(legacy, body);
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=Recovery Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Legacy authorization');
  return { root, legacy, body, file: modeConfigPath(root), git };
}

function unchanged(p) {
  assert.equal(fs.readFileSync(p.legacy, 'utf8'), p.body);
  assert.equal(p.git('status', '--porcelain'), '');
}

function temporaryFiles(p) {
  return fs.readdirSync(path.dirname(p.file)).filter(name => name.startsWith('charterleaf.json.') && name.endsWith('.tmp'));
}

function withFault(method, replacement, run) {
  const original = fs[method];
  fs[method] = (...args) => replacement(original, ...args);
  try { run(); } finally { fs[method] = original; }
}

async function paused(t, p, action, boundary, resume = false) {
  const source = `
    const fs = require('node:fs');
    const project = require(process.argv[1]);
    const root = process.argv[2], action = process.argv[3], boundary = process.argv[4];
    const method = action === 'migrate' ? 'linkSync' : 'renameSync';
    const original = fs[method];
    fs[method] = (...args) => {
      if (boundary === 'after') original(...args);
      fs.writeSync(1, 'READY\\n');
      if (process.argv[5] === 'resume') {
        fs.readSync(0, Buffer.alloc(1), 0, 1, null);
        if (boundary === 'before') return original(...args);
      } else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    if (action === 'migrate') fs.writeSync(1, project.readMode(root) + '\\n');
    else project.saveMode(root, 'reference');
  `;
  const child = spawn(process.execPath, ['-e', source, require.resolve('../lib/project.js'), p.root, action, boundary, resume ? 'resume' : 'kill'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  const closed = once(child, 'close');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`pause timeout: ${stderr}`)); }, 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', () => { clearTimeout(timer); reject(new Error(`early exit: ${stderr}`)); });
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => {
      stdout += data;
      if (stdout.includes('READY\n')) { clearTimeout(timer); resolve(); }
    });
  });
  return { child, closed, stdout: () => stdout };
}

for (const invalid of ['{', '{"version":2,"mode":"auto"}', '{"version":1,"mode":"unknown"}']) {
  test(`recovery: invalid local config ${invalid} never falls back to legacy Auto; explicit save repairs it`, t => {
    const p = fixture(t);
    fs.writeFileSync(p.file, invalid);
    assert.throws(() => readMode(p.root));
    assert.equal(fs.readFileSync(p.file, 'utf8'), invalid);
    saveMode(p.root, 'off');
    assert.equal(readMode(p.root), 'off');
    unchanged(p);
  });
}

for (const action of ['save', 'migrate']) {
  test(`recovery: partial ENOSPC during ${action} preserves authority and permits retry`, t => {
    const p = fixture(t);
    if (action === 'save') saveMode(p.root, 'off');
    withFault('writeFileSync', (original, file, ...args) => {
      if (String(file).startsWith(`${p.file}.`) && String(file).endsWith('.tmp')) {
        original(file, '{', args[1]);
        throw Object.assign(new Error('injected full disk'), { code: 'ENOSPC' });
      }
      return original(file, ...args);
    }, () => assert.throws(() => action === 'save' ? saveMode(p.root, 'reference') : readMode(p.root), { code: 'ENOSPC' }));
    assert.deepEqual(temporaryFiles(p), []);
    if (action === 'save') assert.equal(readMode(p.root), 'off');
    else assert.equal(fs.existsSync(p.file), false);
    if (action === 'save') saveMode(p.root, 'reference');
    assert.equal(readMode(p.root), action === 'save' ? 'reference' : 'auto');
    unchanged(p);
  });
}

test('recovery: failed atomic rename cannot replace saved off or leave a partial config', t => {
  const p = fixture(t);
  saveMode(p.root, 'off');
  const before = fs.readFileSync(p.file, 'utf8');
  withFault('renameSync', () => { throw Object.assign(new Error('injected rename denial'), { code: 'EACCES' }); },
    () => assert.throws(() => saveMode(p.root, 'auto'), { code: 'EACCES' }));
  assert.equal(fs.readFileSync(p.file, 'utf8'), before);
  assert.deepEqual(temporaryFiles(p), []);
  saveMode(p.root, 'reference');
  assert.equal(readMode(p.root), 'reference');
  unchanged(p);
});

test('recovery: unsupported hard links fail migration explicitly; user can still save a choice', t => {
  const p = fixture(t);
  withFault('linkSync', () => { throw Object.assign(new Error('injected unsupported hard links'), { code: 'ENOTSUP' }); },
    () => assert.throws(() => readMode(p.root), { code: 'ENOTSUP' }));
  assert.equal(fs.existsSync(p.file), false);
  assert.deepEqual(temporaryFiles(p), []);
  saveMode(p.root, 'off');
  assert.equal(readMode(p.root), 'off');
  unchanged(p);
});

test('recovery: real directory permission denial preserves saved off and allows retry', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const p = fixture(t);
  saveMode(p.root, 'off');
  const directory = path.dirname(p.file);
  const mode = fs.statSync(directory).mode & 0o777;
  fs.chmodSync(directory, 0o555);
  try {
    assert.throws(() => saveMode(p.root, 'auto'), { code: 'EACCES' });
    assert.equal(readMode(p.root), 'off');
  } finally { fs.chmodSync(directory, mode); }
  saveMode(p.root, 'reference');
  assert.equal(readMode(p.root), 'reference');
  assert.deepEqual(temporaryFiles(p), []);
  unchanged(p);
});

test('recovery: real unreadable local config cannot fall back to legacy Auto', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, t => {
  const p = fixture(t);
  saveMode(p.root, 'off');
  fs.chmodSync(p.file, 0);
  try { assert.throws(() => readMode(p.root), { code: 'EACCES' }); }
  finally { fs.chmodSync(p.file, 0o600); }
  assert.equal(readMode(p.root), 'off');
  unchanged(p);
});

for (const action of ['save', 'migrate']) for (const boundary of ['before', 'after']) {
  test(`recovery: SIGKILL ${boundary} ${action} publication leaves a complete recoverable authority`, { skip: process.platform === 'win32' }, async t => {
    const p = fixture(t);
    if (action === 'save') saveMode(p.root, 'off');
    const worker = await paused(t, p, action, boundary);
    worker.child.kill('SIGKILL');
    const [code, signal] = await worker.closed;
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');
    if (action === 'migrate' && boundary === 'before') assert.equal(fs.existsSync(p.file), false);
    else assert.equal(JSON.parse(fs.readFileSync(p.file, 'utf8')).mode, action === 'migrate' ? 'auto' : boundary === 'before' ? 'off' : 'reference');
    // Migration publishes a hard link; SIGKILL can precede unlinking its temporary name.
    assert.equal(temporaryFiles(p).length, boundary === 'before' || action === 'migrate' ? 1 : 0);
    assert.equal(readMode(p.root), action === 'migrate' ? 'auto' : boundary === 'before' ? 'off' : 'reference');
    saveMode(p.root, 'confirm');
    assert.equal(readMode(p.root), 'confirm');
    assert.equal(fs.statSync(p.file).mode & 0o777, 0o600);
    unchanged(p);
  });
}

test('recovery: a separate-process migration cannot overwrite a concurrent explicit off', async t => {
  const p = fixture(t);
  const worker = await paused(t, p, 'migrate', 'before', true);
  saveMode(p.root, 'off');
  worker.child.stdin.end('x');
  const [code, signal] = await worker.closed;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.match(worker.stdout(), /READY\noff\n/);
  assert.equal(readMode(p.root), 'off');
  assert.deepEqual(temporaryFiles(p), []);
  unchanged(p);
});

test('recovery: twelve simultaneous real processes import one complete mode without worktree changes', async t => {
  const p = fixture(t);
  const workers = Array.from({ length: 12 }, () => {
    const child = spawn(process.execPath, ['-e', "process.stdout.write(require(process.argv[1]).readMode(process.argv[2]))", require.resolve('../lib/project.js'), p.root], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    return once(child, 'close').then(([code]) => { assert.equal(code, 0, stderr); assert.equal(stdout, 'auto'); });
  });
  await Promise.all(workers);
  assert.deepEqual(JSON.parse(fs.readFileSync(p.file, 'utf8')), { version: 1, mode: 'auto' });
  assert.deepEqual(temporaryFiles(p), []);
  unchanged(p);
});

test('recovery: orphan temporary files never grant authorization or override saved off', t => {
  const p = fixture(t);
  fs.unlinkSync(p.legacy);
  fs.writeFileSync(`${p.file}.orphan.tmp`, '{"version":1,"mode":"auto"}');
  assert.equal(readMode(p.root), 'off');
  assert.equal(fs.existsSync(p.file), false);
  saveMode(p.root, 'off');
  fs.writeFileSync(p.legacy, p.body);
  assert.equal(readMode(p.root), 'off');
  unchanged(p);
});

test('recovery: unavailable Git reports failure rather than reading branch-local authorization', t => {
  const p = fixture(t);
  saveMode(p.root, 'off');
  const previous = process.env.PATH;
  process.env.PATH = p.root;
  try { assert.throws(() => readMode(p.root), { code: 'ENOENT' }); }
  finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
  assert.equal(readMode(p.root), 'off');
  unchanged(p);
});
