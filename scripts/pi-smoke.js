'use strict';

// Real Pi RPC/UI smoke: isolated settings and projects, no model request or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { readMode } = require('../lib/project.js');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-pi-smoke-'));
  const project = path.join(temp, 'project');
  const settings = path.join(temp, 'agent');
  fs.mkdirSync(project);
  const extension = path.join(process.env.CHARTERLEAF_PACKAGE || path.resolve(__dirname, '..'), 'extensions/charterleaf.js');
  let child;
  let stderr = '';
  async function start() {
    child = spawn(process.env.PI_BIN || 'pi', ['--mode', 'rpc', '--offline', '--no-session',
      '--no-extensions', '--extension', extension, '--no-skills', '--no-context-files',
      '--no-prompt-templates', '--no-themes', '--no-approve'], {
      cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: settings }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const waiting = new Map();
    let buffer = '';
    let next = 0;
    let selection;
    const dialogs = [];
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
    return { dialogs, async menu(index) {
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
    assert.match(initial.title, /off/);
    assert.equal(initial.options.length, 4);
    assert.equal(readMode(project), 'auto');
    assert.deepEqual(fs.readdirSync(path.join(project, 'specs')), ['.charterleaf.json']);
    fs.writeFileSync(path.join(project, 'specs/constitution.md'), '# Keep this document\n');
    await client.menu(1);
    assert.equal(readMode(project), 'confirm');
    await stop();
    client = await start();
    assert.match((await client.menu(2)).title, /confirm/, 'mode restores in a new real Pi process');
    assert.equal(readMode(project), 'reference');
    assert.match((await client.menu(3)).title, /reference/);
    assert.equal(readMode(project), 'off');
    assert.equal(fs.readFileSync(path.join(project, 'specs/constitution.md'), 'utf8'), '# Keep this document\n');
    console.log('PASS: real Pi loader, native RPC select, cancellation, enable/switch/disable, process restore; no model calls.');
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
