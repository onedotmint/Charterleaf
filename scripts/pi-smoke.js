'use strict';

// Real Pi RPC/UI smoke: isolated settings and projects, no model request or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const packageRoot = path.resolve(process.env.CHARTERLEAF_PACKAGE || path.join(__dirname, '..'));
const { modeConfigPath, readMode } = require(path.join(packageRoot, 'lib/project.js'));

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-pi-smoke-'));
  const project = path.join(temp, 'project');
  const settings = path.join(temp, 'agent');
  fs.mkdirSync(project);
  const extension = path.join(packageRoot, 'extensions/charterleaf.js');
  let child;
  let stderr = '';
  async function start(cwd = project) {
    // A Node entry point avoids spawning Windows .cmd shims without a shell.
    child = spawn(process.env.PI_CLI ? process.execPath : process.env.PI_BIN || 'pi', [
      ...(process.env.PI_CLI ? [process.env.PI_CLI] : []), '--mode', 'rpc', '--offline', '--no-session',
      '--no-extensions', '--extension', extension, '--no-skills', '--no-context-files',
      '--no-prompt-templates', '--no-themes', '--no-approve'], {
      cwd, env: { ...process.env, PI_CODING_AGENT_DIR: settings }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const waiting = new Map();
    let buffer = '';
    let next = 0;
    let selection;
    const dialogs = [];
    const notifications = [];
    child.stderr.on('data', (data) => { stderr += data; });
    child.stdout.setEncoding('utf8');
    const send = (data) => child.stdin.write(`${JSON.stringify(data)}\n`);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (record.type === 'response') waiting.get(record.id)?.resolve(record);
        if (record.type === 'extension_ui_request' && record.method === 'notify') notifications.push(record);
        if (record.type === 'extension_ui_request' && record.method === 'select') {
          dialogs.push(record);
          send({ type: 'extension_ui_response', id: record.id,
            ...(selection === undefined ? { cancelled: true } : { value: record.options[selection] }) });
        }
      }
    });
    const rejectAll = (error) => { for (const entry of waiting.values()) entry.reject(error); };
    child.on('error', rejectAll);
    child.on('exit', (code) => rejectAll(new Error(`Pi exited ${code}: ${stderr}`)));
    async function request(type, extra = {}) {
      const id = String(++next);
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Pi timed out: ${type}\n${stderr}`)), 20000);
        waiting.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); } });
        send({ id, type, ...extra });
      });
      waiting.delete(id);
      assert.equal(result.success, true, result.error);
      return result;
    }
    const commands = await request('get_commands');
    assert.ok(commands.data.commands.some((command) => command.name === 'charterleaf'), 'real loader discovers /charterleaf');
    return { dialogs, notifications, async menu(index) {
      selection = index;
      const result = await request('prompt', { message: '/charterleaf' });
      assert.equal(result.data.disposition, 'handled', 'menu must not start a model request');
      return dialogs.at(-1);
    } };
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  try {
    let client = await start();
    assert.equal(client.dialogs.length, 0, 'no startup adoption popup');
    await client.menu();
    assert.equal(fs.existsSync(path.join(project, 'specs')), false, 'cancel creates nothing');
    const initial = await client.menu(0);
    assert.match(initial.title, /off \(not configured\)/);
    assert.match(initial.title, /Existing specs do not enable automation/);
    assert.match(initial.title, /no automatic constraint loading or code edit checks/);
    assert.match(client.notifications.at(-1).message, /maintain only justified durable specs/);
    assert.equal(initial.options.length, 4);
    assert.equal(readMode(project), 'auto');
    assert.deepEqual(fs.readdirSync(path.join(project, 'specs')), ['.charterleaf.json']);
    fs.writeFileSync(path.join(project, 'specs/constitution.md'), '# Keep this document\n');
    await client.menu(1);
    assert.equal(readMode(project), 'confirm');
    assert.match(client.notifications.at(-1).message, /approve each spec modification/);
    await stop();
    client = await start();
    assert.match((await client.menu(2)).title, /confirm/, 'mode restores in a new real Pi process');
    assert.equal(readMode(project), 'reference');
    assert.match(client.notifications.at(-1).message, /never modify specs/);
    assert.match((await client.menu(3)).title, /reference/);
    assert.equal(readMode(project), 'off');
    assert.match(client.notifications.at(-1).message, /no automatic constraint loading or code edit checks; existing documents preserved/);
    assert.match((await client.menu()).title, /off \(disabled\)/);
    assert.equal(fs.readFileSync(path.join(project, 'specs/constitution.md'), 'utf8'), '# Keep this document\n');
    await stop();
    const repository = path.join(temp, 'git-project');
    fs.mkdirSync(repository);
    const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const commit = (subject) => git('-c', 'user.name=Pi Smoke', '-c', 'user.email=smoke@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', subject);
    git('init', '--quiet');
    client = await start(repository);
    assert.match((await client.menu(0)).title, /off \(not configured\)/);
    assert.equal(readMode(repository), 'auto');
    assert.ok(client.notifications.at(-1).message.includes(modeConfigPath(repository)));
    assert.equal(fs.existsSync(path.join(repository, 'specs')), false, 'Git enable writes only local metadata');
    assert.equal(git('status', '--porcelain'), '');
    await stop();
    fs.unlinkSync(modeConfigPath(repository)); // Reset this temporary fixture to exercise legacy import.
    fs.mkdirSync(path.join(repository, 'specs'));
    const legacy = path.join(repository, 'specs/.charterleaf.json');
    fs.writeFileSync(legacy, '{"version":1,"mode":"auto"}\n');
    fs.writeFileSync(path.join(repository, 'specs/constitution.md'), '# Current branch constraints\n');
    git('add', 'specs');
    commit('Legacy Auto branch');
    const original = git('branch', '--show-current').trim();
    git('checkout', '--quiet', '-b', 'without-specs');
    git('rm', '--quiet', '-r', 'specs');
    commit('Branch with no specs or legacy mode');
    git('checkout', '--quiet', original);
    client = await start(repository);
    assert.match((await client.menu()).title, /Charterleaf — auto/, 'real startup migrates legacy Auto');
    assert.equal(JSON.parse(fs.readFileSync(modeConfigPath(repository), 'utf8')).mode, 'auto');
    assert.equal(git('status', '--porcelain'), '', 'migration never changes tracked files');
    await stop();
    git('checkout', '--quiet', 'without-specs');
    assert.equal(fs.existsSync(path.join(repository, 'specs')), false);
    client = await start(repository);
    assert.match((await client.menu()).title, /Charterleaf — auto/, 'Auto survives a branch switch and a new Pi process');
    await client.menu(3);
    assert.equal(readMode(repository), 'off');
    git('checkout', '--quiet', original);
    assert.equal(JSON.parse(fs.readFileSync(legacy, 'utf8')).mode, 'auto');
    assert.match((await client.menu()).title, /off \(disabled\)/, 'restored legacy Auto cannot undo explicit off');
    assert.equal(git('status', '--porcelain'), '');
    console.log('PASS: real Pi loader, native RPC menu/notifications, cancellation, enable/switch/disable, legacy migration, cross-branch/process persistence and explicit off; no model calls.');
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
