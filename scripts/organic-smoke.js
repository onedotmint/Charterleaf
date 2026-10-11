'use strict';

// Real, paid Pi acceptance; no dependencies. Usage: node scripts/organic-smoke.js [--case A,B,...]
// --self-test checks the harness without Pi. PI_BIN / CHARTERLEAF_PACKAGE select the host/package;
// Set CHARTERLEAF_MODEL=provider/id explicitly; no automatic provider fallback. Task deadline: 10 minutes.
// Evidence is private and retained even on failure; copied auth/models config is removed at exit.
// Personal settings/resources are not imported, only model defaults and endpoint config. Not an OS sandbox.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const packageRoot = path.resolve(process.env.CHARTERLEAF_PACKAGE || path.join(__dirname, '..'));
const extension = path.join(packageRoot, 'extensions/charterleaf.js');
const timeout = Number(process.env.ORGANIC_TIMEOUT_MS || 600000);
const config = 'specs/.charterleaf.json';
const testCommand = ['--test', 'tests/money.test.js'];
const children = new Set();
const development = 'Implement quoteFee in src/money.js so the existing invoice tests pass. Keep the accepted rounding behavior and public exports unchanged. Run the tests. Use standard read/edit/write for file changes, and shell only to run validation.';
const investigation = 'Investigate why two line fees of 0.5 cents produce a total of 0 cents here, while rounding their combined raw amount produces 1 cent. Read src/money.js and tests/money.test.js and explain the accounting boundary. Do not change implementation or tests; improvements to durable project guidance are allowed.';
const roundingSource = `// Integer-only money arithmetic. Denominator must be positive.
function roundRatioEven(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('positive denominator required');
  const sign = numerator < 0n ? -1n : 1n;
  const value = numerator * sign;
  const whole = value / denominator;
  const remainder = value % denominator;
  const increment = remainder * 2n > denominator ||
    (remainder * 2n === denominator && whole % 2n === 1n);
  return sign * (whole + (increment ? 1n : 0n));
}

function quoteFee(lines, basisPoints) {
  return null; // TODO: sum individually settled line fees, in cents.
}
module.exports = { roundRatioEven, quoteFee };
`;
const implementation = 'return lines.reduce((total, cents) => total + roundRatioEven(cents * basisPoints, 10000n), 0n);';
const completeSource = roundingSource.replace('return null; // TODO: sum individually settled line fees, in cents.', implementation);
const moneyTests = `const assert = require('node:assert/strict');
const { test } = require('node:test');
const { roundRatioEven, quoteFee } = require('../src/money.js');
// Accepted settlement examples from the accounting owner. Do not round a combined raw fee.
test('exact ties go to the even cent, symmetrically for credits', () => {
  for (const [n, d, expected] of [[1n,2n,0n],[3n,2n,2n],[5n,2n,2n],[-1n,2n,0n],[-3n,2n,-2n],[7n,4n,2n],[9n,4n,2n]]) {
    assert.equal(roundRatioEven(n, d), expected);
  }
  assert.throws(() => roundRatioEven(1n, 0n), RangeError);
});
test('fee settles each line before summing; splitting is deliberately not neutral', () => {
  assert.equal(quoteFee([1n, 1n], 5000n), 0n);
  assert.equal(quoteFee([2n], 5000n), 1n);
  assert.equal(quoteFee([3n, 5n], 5000n), 4n);
  assert.equal(quoteFee([-3n, -5n], 5000n), -4n);
  assert.equal(quoteFee([], 125n), 0n);
});
test('values beyond floating point precision remain exact', () => {
  assert.equal(quoteFee([9007199254740993n], 10000n), 9007199254740993n);
});
`;
const LINE_BOUNDARY = /(?:each|every)(?:[ -](?:invoice|input))?[ -]line|per[- ]line|(?:individual|independent)[^\n]{0,50}line|line[^\n]{0,120}before[^\n]{0,60}(sum|aggregat)/i;
const contract = `---
id: money.settlement
applies_to:
  - src/**
  - tests/**
---
# Money settlement

### MONEY-001 — Half-even is a contract, not an implementation preference
Settle exact rational amounts to the nearest cent; exact ties choose the even cent,
symmetrically for debit and credit. Use integer arithmetic, including above 2^53.

### MONEY-002 — Line boundary
Settle each line fee before summing. Combining raw fees before rounding is forbidden:
two 0.5-cent line fees settle to 0 cents, while a single 1-cent fee settles to 1 cent.
Splitting an invoice line is intentionally not fee-neutral.
`;
const authority = `# Accounting design decisions — authoritative owner

The accounting owner accepted these decisions. This document, not current code, owns their rationale.

1. Settle each line separately before computing an invoice fee total. Independent ledger entries must reconcile with their own settlement receipts; moving rounding across the aggregation boundary breaks reconciliation even if the final numerical error appears smaller.

2. At an exact midpoint, choose the even integer cent. This half-even policy avoids systematic upward drift across repeated settlement, and it applies symmetrically to negative adjustments as well as positive charges. Half-up and JavaScript Math.round are not equivalent substitutes.

3. Money remains integer cents throughout public interfaces, and intermediate ratios remain exact integers too. The historical migration from floating point was accepted after reconciliation failures on values above two to the fifty-third power, not as a stylistic preference.

4. Splitting a line is intentionally not fee-neutral. A line is the accounting unit, not an arbitrary formatting unit, so downstream display transformations must never regroup unsettled lines merely to make a rendered table shorter or prettier.

5. Empty invoices settle to zero cents without special provider calls. This is an accepted domain behavior rather than an accidental consequence of reduction initialization, and it permits idempotent replay of ledger batches containing no chargeable entries.

6. A denominator must be positive; a zero or negative denominator is rejected before any arithmetic result is published. Invalid ratios indicate corrupted configuration and must not be converted into an apparently valid zero-valued financial transaction.
`;

function put(root, name, body) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
function json(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function text(message) {
  return typeof message?.content === 'string' ? message.content :
    (message?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}
function snapshot(root, relative = '') {
  const files = {};
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) files[name] = { symlink: fs.readlinkSync(path.join(root, name)) };
    else if (entry.isDirectory()) Object.assign(files, snapshot(root, name));
    else files[name] = fs.readFileSync(path.join(root, name), 'utf8');
  }
  return files;
}
function specs(files) { return Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('specs/') && name !== config)); }
function code(files) { return Object.fromEntries(Object.entries(files).filter(([name]) => !name.startsWith('specs/'))); }
function parseLines(chunk, consume, state) {
  state.buffer += chunk;
  for (let end; (end = state.buffer.indexOf('\n')) >= 0;) {
    const line = state.buffer.slice(0, end).replace(/\r$/, '');
    state.buffer = state.buffer.slice(end + 1);
    if (line.trim()) consume(JSON.parse(line));
  }
}
function run(command, args, cwd, env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
}
function git(args, cwd, env) {
  const result = run('git', args, cwd, env);
  assert.equal(result.status, 0, `git ${args[0]} failed`);
  return result.stdout;
}
function fixture(root, mode, options, env) {
  fs.mkdirSync(root, { recursive: true });
  put(root, config, `${JSON.stringify({ version: 1, mode })}\n`);
  put(root, 'README.md', '# Invoice fee library\nRun `node --test tests/money.test.js`. Accounting acceptance cases live in tests/money.test.js.\n' +
    (options.docs ? 'The authoritative rationale lives in docs/accounting-decisions.md.\n' : ''));
  put(root, 'src/money.js', options.complete ? completeSource : roundingSource);
  put(root, 'tests/money.test.js', moneyTests);
  if (options.existing) put(root, 'specs/capabilities/money.md', contract);
  if (options.docs) put(root, 'docs/accounting-decisions.md', authority);
  if (options.bug) put(root, 'src/money.js', completeSource.replace('whole % 2n === 1n', 'true'));
  git(['init', '--quiet'], root, env);
  git(['add', '.'], root, env);
  git(['-c', 'user.name=Organic Smoke', '-c', 'user.email=smoke@invalid', '-c', 'commit.gpgSign=false',
    'commit', '--quiet', '-m', 'Accepted accounting fixture'], root, env);
}

// LF-only RPC client, following pi-smoke.js. Settle, not prompt acceptance/agent_end, ends a task.
function client(project, agent, evidence, env, approved, jsonPrompt, model) {
  fs.mkdirSync(evidence, { recursive: true });
  const args = ['--mode', jsonPrompt ? 'json' : 'rpc', '--offline', '--no-extensions', '--extension', extension,
    '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-mcp', '--no-approve',
    '--tools', 'read,edit,write,bash,grep,find,ls', '--session-dir', path.join(evidence, 'sessions')];
  if (model) args.push('--provider', model.provider, '--model', model.id);
  if (jsonPrompt) args.push('--', jsonPrompt);
  json(path.join(evidence, 'invocation.json'), { args, cwd: project, interface: jsonPrompt ? 'json (hasUI=false)' : 'rpc (hasUI=true)' });
  const child = spawn(process.env.PI_BIN || 'pi', args, {
    cwd: project, env: { ...env, PI_CODING_AGENT_DIR: agent }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('close', () => children.delete(child));
  const records = [];
  const waiting = new Map();
  const state = { buffer: '' };
  let next = 0;
  let terminalError;
  let settle;
  const raw = fs.openSync(path.join(evidence, 'stdout.jsonl'), 'w', 0o600);
  const errors = fs.openSync(path.join(evidence, 'stderr.log'), 'w', 0o600);
  const input = fs.openSync(path.join(evidence, 'stdin.jsonl'), 'w', 0o600);
  function fail(error) {
    terminalError = error;
    for (const pending of waiting.values()) pending.reject(error);
    settle?.reject(error);
  }
  function send(record) {
    const line = `${JSON.stringify(record)}\n`;
    fs.writeSync(input, line);
    child.stdin.write(line);
  }
  child.stdin.on('error', fail);
  // JSON mode consumes redirected stdin before starting; EOF is mandatory for a one-shot prompt.
  if (jsonPrompt) child.stdin.end();
  child.stderr.on('data', (data) => fs.writeSync(errors, data));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    fs.writeSync(raw, chunk);
    try {
      parseLines(chunk, (record) => {
        records.push(record);
        if (record.type === 'response') waiting.get(record.id)?.resolve(record);
        if (record.type === 'agent_settled') settle?.resolve(record);
        if (record.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(record.method)) {
          // Only Charterleaf's exact per-write proposal can be approved; unexpected dialogs cancel.
          send({ type: 'extension_ui_response', id: record.id,
            ...(record.method === 'confirm' && /^Charterleaf: modify specs\//.test(record.title)
              ? { confirmed: approved === true } : { cancelled: true }) });
        }
      }, state);
    } catch (error) { fail(error); }
  });
  const closed = new Promise((resolve) => child.once('close', (status, signal) => {
    if (!jsonPrompt || status !== 0) fail(new Error(`Pi exited (status=${status}, signal=${signal}); see stderr.log`));
    resolve(status);
  }));
  child.on('error', fail);
  async function request(type, extra = {}) {
    if (terminalError) throw terminalError;
    const id = String(++next);
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`RPC deadline: ${type}`)), 30000);
        waiting.set(id, { resolve, reject });
        send({ id, type, ...extra });
      });
      assert.equal(response.success, true, `${type}: ${response.error || 'unsuccessful'}`);
      return response.data;
    } finally { clearTimeout(timer); waiting.delete(id); }
  }
  return { records, request, async prompt(message) {
    let timer;
    try {
      const settled = new Promise((resolve, reject) => {
        settle = { resolve, reject };
        timer = setTimeout(() => reject(new Error('Task deadline; partial evidence retained')), timeout);
      });
      // Attach a rejection handler before awaiting the prompt response.
      const accepted = request('prompt', { message });
      const [response, event] = await Promise.all([accepted, settled]);
      assert.equal(response.disposition, 'started');
      assert.equal(event.aborted, false);
    } finally { clearTimeout(timer); settle = undefined; }
  }, async collect() {
    if (jsonPrompt) {
      const deadline = setTimeout(() => child.kill('SIGKILL'), timeout);
      let exitStatus;
      try { exitStatus = await closed; }
      finally { clearTimeout(deadline); }
      const entries = [];
      const sessionDir = path.join(evidence, 'sessions');
      for (const file of fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir) : []) {
        if (!file.endsWith('.jsonl')) continue;
        const stream = { buffer: '' };
        parseLines(fs.readFileSync(path.join(evidence, 'sessions', file), 'utf8'), (entry) => entries.push(entry), stream);
      }
      return { entries, exitStatus, messages: entries.flatMap((entry) => entry.type === 'message' ? [entry.message] :
        entry.type === 'custom_message' ? [{ role: 'custom', ...entry }] : []) };
    }
    const { messages } = await request('get_messages');
    const { entries } = await request('get_entries');
    return { messages, entries, stats: await request('get_session_stats'), state: await request('get_state') };
  }, async stop() {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'close');
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await exited; } catch { /* Startup errors are already recorded. */ }
      finally { clearTimeout(timer); }
    }
    for (const fd of [raw, errors, input]) fs.closeSync(fd);
  } };
}

function evidenceSummary(data, records) {
  const assistants = data.messages.filter((message) => message.role === 'assistant');
  const reviewEntries = data.entries.filter((entry) => entry.type === 'custom_message' && entry.customType === 'charterleaf' && /Charterleaf final review/.test(text(entry)));
  const reviewMessages = data.messages.filter((message) => message.role === 'custom' && message.customType === 'charterleaf' && /Charterleaf final review/.test(text(message)));
  const usage = assistants.map((message) => ({ provider: message.provider, model: message.model, responseModel: message.responseModel,
    stopReason: message.stopReason, usage: message.usage }));
  return { sessionId: data.state?.sessionId || data.entries.find((entry) => entry.type === 'session')?.id,
    assistantMessages: assistants.length, requestsWithUsage: usage.filter((item) => item.usage?.totalTokens > 0).length,
    // Assistant-message count is not an HTTP request counter (provider-internal retries are not visible).
    usage, finalReviews: reviewEntries.length, finalReviewsInMessages: reviewMessages.length,
    markers: assistants.flatMap((message, index) => [...text(message).matchAll(/^\s*<!-- charterleaf: (review|covered|no-value|proposed) -->\s*$/gm)].map((match) => ({ index, kind: match[1] }))),
    approvals: records.filter((record) => record.type === 'extension_ui_request' && record.method === 'confirm'),
    tools: records.filter((record) => record.type.startsWith('tool_execution_')) };
}

async function main() {
  assert.ok(Number.isFinite(timeout) && timeout > 0, 'positive ORGANIC_TIMEOUT_MS');
  const argv = process.argv.slice(2);
  const selfTest = argv.includes('--self-test');
  const caseIndex = argv.indexOf('--case');
  assert.ok(argv.every((arg, index) => arg === '--self-test' || arg === '--case' || index === caseIndex + 1 && caseIndex >= 0), 'unknown argument');
  assert.ok(caseIndex < 0 || argv[caseIndex + 1], '--case needs comma-separated case names');
  const selected = caseIndex < 0 ? null : new Set(argv[caseIndex + 1].split(','));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-organic-'));
  fs.chmodSync(temp, 0o700);
  console.log(`Evidence directory: ${temp}`);
  json(path.join(temp, 'package-snapshot.json'), Object.fromEntries([
    'extensions/charterleaf.js', 'lib/charterleaf.js', 'lib/project.js',
    'skills/charterleaf/runtime.md', 'skills/charterleaf/SKILL.md',
  ].map((file) => [file, fs.readFileSync(path.join(packageRoot, file), 'utf8')])));
  const agent = path.join(temp, 'agent');
  const home = path.join(temp, 'home');
  fs.mkdirSync(agent, { mode: 0o700 });
  fs.mkdirSync(home, { mode: 0o700 });
  function removePrivateCopies() {
    for (const name of ['auth.json', 'models.json']) fs.rmSync(path.join(agent, name), { force: true });
  }
  process.once('exit', removePrivateCopies);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    for (const child of children) child.kill('SIGTERM');
    removePrivateCopies();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
  put(temp, 'empty-git-config', '');
  fs.mkdirSync(path.join(temp, 'git-template'));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
    GIT_CONFIG_GLOBAL: path.join(temp, 'empty-git-config'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_TEMPLATE_DIR: path.join(temp, 'git-template'), PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' };
  for (const key of Object.keys(env)) {
    if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key) ||
      /^(BASH_ENV|ENV|PI_CODING_AGENT_SESSION_DIR|PI_SESSION_ID|PI_SESSION_FILE|PI_PROVIDER|PI_MODEL|PI_REASONING_LEVEL)$/.test(key)) delete env[key];
  }
  const results = [];
  let chosen;
  let discovery;
  async function task(name, project, prompt, options, verify) {
    const dir = path.join(temp, name);
    fs.mkdirSync(dir, { recursive: true });
    const before = snapshot(project);
    json(path.join(dir, 'before.json'), before);
    put(dir, 'prompt.txt', prompt);
    const assertions = [];
    let rpc;
    let data;
    let summary;
    const check = (label, fn) => {
      try { fn(); assertions.push({ label, pass: true }); }
      catch (error) { assertions.push({ label, pass: false, error: error.message }); }
    };
    try {
      rpc = client(project, agent, dir, env, options.approve, options.noUI ? prompt : undefined, chosen);
      if (!options.noUI) {
        const commands = await rpc.request('get_commands');
        assert.ok(commands.commands.some((command) => command.name === 'charterleaf'), 'real extension loader discovers command');
        await rpc.request('set_auto_retry', { enabled: false });
        await rpc.request('set_auto_compaction', { enabled: false });
        await rpc.prompt(prompt);
      }
      data = await rpc.collect();
      json(path.join(dir, 'conversation.json'), data);
      if (options.noUI) check('JSON host exited successfully', () => assert.equal(data.exitStatus, 0));
      summary = evidenceSummary(data, rpc.records);
      json(path.join(dir, 'tools.json'), summary.tools);
      check('real model completed with nonzero provider usage', () => {
        assert.ok(summary.requestsWithUsage > 0);
        assert.ok(data.messages.some((message) => message.role === 'assistant' && message.stopReason === 'stop'));
        assert.deepEqual(data.messages.filter((message) => message.role === 'assistant' && ['error', 'aborted', 'length'].includes(message.stopReason)), []);
      });
      check('no extension handler errors', () => assert.equal(rpc.records.filter((record) => record.type === 'extension_error').length, 0));
      check('at most one final review; both RPC views agree', () => {
        assert.ok(summary.finalReviews <= 1);
        assert.equal(summary.finalReviews, summary.finalReviewsInMessages);
      });
      check('completed knowledge judgment does not trigger a redundant review', () => {
        const reviewIndex = data.messages.findIndex((message) => message.role === 'custom' && message.customType === 'charterleaf' && /Charterleaf final review/.test(text(message)));
        const prior = reviewIndex < 0 ? data.messages : data.messages.slice(0, reviewIndex);
        const lastAssistant = prior.findLast((message) => message.role === 'assistant');
        const lastTool = prior.findLast((message) => message.role === 'toolResult');
        const lastCall = summary.tools.find((record) => record.type === 'tool_execution_start' && record.toolCallId === lastTool?.toolCallId);
        const captured = lastTool && !lastTool.isError && ['write', 'edit'].includes(lastCall?.toolName) &&
          typeof lastCall.args.path === 'string' && path.resolve(project, lastCall.args.path).startsWith(`${project}/specs/`);
        if (/^\s*<!-- charterleaf: (?:covered|proposed) -->\s*$/m.test(text(lastAssistant)) || captured) assert.equal(summary.finalReviews, 0);
      });
      check('user mode config preserved', () => assert.equal(snapshot(project)[config], before[config]));
      check('no automatic git commit or stage', () => {
        assert.equal(git(['rev-list', '--count', 'HEAD'], project, env).trim(), '1');
        assert.equal(git(['diff', '--cached'], project, env), '');
      });
      await verify({ project, before, after: snapshot(project), check, summary, data, records: rpc.records, dir });
    } catch (error) {
      assertions.push({ label: 'host/task completed', pass: false, error: error.message });
      // Capture inspectable partial history even on a provider error/deadline.
      if (rpc && !options.noUI) {
        try { data = await rpc.collect(); summary = evidenceSummary(data, rpc.records); json(path.join(dir, 'conversation.json'), data); }
        catch { /* Raw wire events, session and stderr remain available. */ }
      }
    } finally {
      if (rpc) {
        json(path.join(dir, 'tools.json'), rpc.records.filter((record) => record.type.startsWith('tool_execution_')));
        await rpc.stop();
      }
      check('final snapshot retained', () => json(path.join(dir, 'after.json'), snapshot(project)));
      for (const [file, args] of [['git.diff', ['diff', '--no-ext-diff', '--no-textconv', 'HEAD']],
        ['git-status.txt', ['status', '--short', '--untracked-files=all']]]) {
        const result = run('git', args, project, env);
        put(dir, file, result.stdout || '');
        put(dir, `${file}.stderr`, result.stderr || '');
        check(`${file} retained successfully`, () => assert.equal(result.status, 0));
      }
      // Untracked specs do not appear in git diff; retain their literal patch too.
      let untracked = '';
      const names = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], project, env);
      check('untracked file inventory retained', () => assert.equal(names.status, 0));
      for (const name of (names.stdout || '').split('\0').filter(Boolean)) {
        const result = run('git', ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', path.join(project, name)], project, env);
        untracked += result.stdout || '';
      }
      put(dir, 'untracked.diff', untracked);
      json(path.join(dir, 'assertions.json'), assertions);
      json(path.join(dir, 'summary.json'), summary || { incomplete: true });
      const result = { name, pass: assertions.every((item) => item.pass), assertions, ...(summary || {}) };
      delete result.tools;
      results.push(result);
      json(path.join(temp, 'results.json'), results);
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${name}: ${summary?.assistantMessages ?? '?'} assistant messages, ${summary?.finalReviews ?? '?'} final reviews`);
      for (const item of assertions.filter((item) => !item.pass)) console.log(`  ${item.label}: ${item.error}`);
    }
  }
  function validates({ project, dir, check }) {
    const result = run(process.execPath, testCommand, project, env);
    put(dir, 'validation.stdout', result.stdout || '');
    put(dir, 'validation.stderr', result.stderr || '');
    check('original accounting acceptance tests pass', () => assert.equal(result.status, 0));
    // Independent oracle cannot be weakened by the model editing the fixture tests.
    const oracle = run(process.execPath, ['-e', `const a=require('node:assert/strict');const m=require('./src/money.js');
      for(const [n,v] of [[1n,0n],[3n,2n],[5n,2n],[-1n,0n],[-3n,-2n]])a.equal(m.roundRatioEven(n,2n),v);
      a.equal(m.quoteFee([1n,1n],5000n),0n);a.equal(m.quoteFee([3n,5n],5000n),4n);
      a.equal(m.quoteFee([-3n,-5n],5000n),-4n);a.equal(m.quoteFee([],5000n),0n);
      a.equal(m.quoteFee([9007199254740993n],10000n),9007199254740993n);
      a.throws(()=>m.roundRatioEven(1n,0n),RangeError);`], project, env);
    put(dir, 'oracle.stdout', oracle.stdout || '');
    put(dir, 'oracle.stderr', oracle.stderr || '');
    check('independent exact-money oracle passes', () => assert.equal(oracle.status, 0));
  }
  function knowledge({ project, after, check, dir, records }) {
    const documents = specs(after);
    const body = Object.values(documents).join('\n');
    check('evidenced settlement boundary recorded in real spec files', () => {
      assert.ok(Object.keys(documents).some((name) => /^specs\/(capabilities|engineering)\/.*\.md$/.test(name)));
      // A concise reference to the authoritative rounding cases is also durable knowledge, not a copy.
      assert.match(body, /half[ -]?even|ties?[^\n]{0,100}even|banker|tests\/money\.test\.js/i);
      assert.match(body, LINE_BOUNDARY);
      assert.ok(body.length < 6000, 'bounded knowledge, not wholesale source/test dump');
    });
    const lint = run(process.execPath, [path.join(packageRoot, 'bin/charterleaf.js'), 'lint'], project, env);
    put(dir, 'lint.stdout', lint.stdout || '');
    put(dir, 'lint.stderr', lint.stderr || '');
    check('real CLI structural lint passes', () => assert.equal(lint.status, 0));
    check('spec changes used successful standard mutation tools', () => assert.ok(records.some((record) => record.type === 'tool_execution_start' &&
      ['edit', 'write'].includes(record.toolName) && typeof record.args.path === 'string' &&
      path.resolve(project, record.args.path).startsWith(`${project}/specs/`) &&
      records.some((end) => end.type === 'tool_execution_end' && end.toolCallId === record.toolCallId && !end.isError))));
  }
  const cases = ['A', 'B', 'C', 'D', 'E', 'F1', 'F2', 'G-auto', 'G-confirm-yes', 'G-confirm-no', 'G-reference', 'G-read-only', 'G-no-ui', 'G-confirm-no-probe', 'G-no-ui-probe'];
  if (selected) assert.ok([...selected].every((name) => cases.includes(name)), `case names: ${cases.join(',')}`);
  try {
    if (selfTest) {
      const project = path.join(temp, 'self-test');
      fixture(project, 'auto', { complete: true, existing: true }, env);
      const assertions = [];
      validates({ project, dir: temp, check: (label, fn) => { fn(); assertions.push({ label, pass: true }); } });
      const parsed = [];
      const framing = { buffer: '' };
      parseLines('{"text":"a\u2028b\u2029c"}\r', (record) => parsed.push(record), framing);
      parseLines('\n{"ok":true}\n', (record) => parsed.push(record), framing);
      assert.deepEqual(parsed, [{ text: 'a\u2028b\u2029c' }, { ok: true }]);
      assert.equal(Object.keys(snapshot(project)).some((name) => name.startsWith('.git/')), false);
       assert.equal(Object.keys(specs(snapshot(project))).length, 1);
       for (const sentence of ['Settle each invoice-line independently, then sum settled cents.',
         'Settle a fee independently for every input line, then sum settled cents.',
         'Settle each invoice line before summing.', 'Settle each line fee before summing.']) assert.match(sentence, LINE_BOUNDARY);
       assert.ok(!LINE_BOUNDARY.test('Sum the raw fees and round only the aggregate.'));
      const broken = path.join(temp, 'incomplete');
      fixture(broken, 'auto', {}, env);
      assert.notEqual(run(process.execPath, testCommand, broken, env).status, 0);
      const bug = path.join(temp, 'bug');
      fixture(bug, 'auto', { bug: true, existing: true }, env);
      assert.notEqual(run(process.execPath, testCommand, bug, env).status, 0);
      json(path.join(temp, 'assertions.json'), assertions);
      console.log('PASS harness self-test: LF framing, snapshots, exact-money oracle, failing TODO/half-up fixtures. No Pi/model calls.');
      return;
    }
    const personal = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
    function privateJson(file) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { throw new Error('Private model/settings configuration could not be parsed; contents not printed'); }
    }
    const saved = fs.existsSync(path.join(personal, 'settings.json')) ? privateJson(path.join(personal, 'settings.json')) : {};
    const settings = { cacheWarming: 'off', compaction: { enabled: false }, retry: { enabled: false }, shellPath: '/bin/bash' };
    for (const key of ['defaultProvider', 'defaultModel', 'defaultThinkingLevel']) if (typeof saved[key] === 'string') settings[key] = saved[key];
    json(path.join(agent, 'settings.json'), settings);
    if (fs.existsSync(path.join(personal, 'auth.json'))) {
      fs.copyFileSync(path.join(personal, 'auth.json'), path.join(agent, 'auth.json'));
      fs.chmodSync(path.join(agent, 'auth.json'), 0o600);
    }
    // Endpoint overrides are connection configuration, not personal prompts/tools/packages.
    // Pi keeps apiKey/headers out of RPC model definitions; credentials stay in this private copy.
    const modelsFile = path.join(personal, 'models.json');
    if (fs.existsSync(modelsFile)) {
      const models = privateJson(modelsFile);
      function checkUrls(value) {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
          if (key === 'baseUrl' && typeof item === 'string') {
            const url = new URL(item);
            assert.ok(!url.username && !url.password && !url.search && !url.hash,
              'endpoint credentials must not be embedded in a URL recorded by RPC');
          } else checkUrls(item);
        }
      }
      checkUrls(models);
      json(path.join(agent, 'models.json'), models);
      fs.chmodSync(path.join(agent, 'models.json'), 0o600);
    }
    const probe = path.join(temp, 'model-project');
    fs.mkdirSync(probe);
    discovery = client(probe, agent, path.join(temp, 'model-discovery'), env);
    const state = await discovery.request('get_state');
    const available = (await discovery.request('get_available_models')).models;
    const preferred = process.env.CHARTERLEAF_MODEL;
    assert.ok(preferred, 'Set CHARTERLEAF_MODEL=provider/id explicitly; no model is selected automatically');
    chosen = available.find((model) => `${model.provider}/${model.id}` === preferred);
    assert.ok(chosen, 'Explicitly selected model is unavailable in isolated connection configuration');
    chosen = { provider: chosen.provider, id: chosen.id };
    json(path.join(temp, 'model.json'), { selected: chosen, preferred, savedDefault: { provider: saved.defaultProvider, id: saved.defaultModel },
      piStartupDefault: state.model && { provider: state.model.provider, id: state.model.id },
      availability: 'get_available_models authenticatable catalog; real request success is checked per task',
      limits: 'Only model defaults, auth.json and models.json connection config imported; no personal instructions, MCP, packages or provider extensions. No OS sandbox. Usage counts assistant messages, not hidden HTTP retries.' });
    console.log(`Model: ${chosen.provider}/${chosen.id}`);
    await discovery.stop();
    discovery = undefined;
    const wanted = (name) => !selected || selected.has(name);
    let reusable;
    if (wanted('A') || wanted('F1') || wanted('F2')) {
      const project = path.join(temp, 'project-A');
      fixture(project, 'auto', {}, env);
      await task('A', project, development, {}, (ctx) => {
        validates(ctx); knowledge(ctx);
        ctx.check('acceptance tests not weakened', () => assert.equal(ctx.after['tests/money.test.js'], ctx.before['tests/money.test.js']));
      });
      reusable = project;
    }
    if (wanted('B') || (wanted('F1') || wanted('F2')) && !Object.keys(specs(snapshot(reusable))).length) {
      const project = path.join(temp, 'project-B');
      fixture(project, 'auto', { complete: true }, env);
      await task('B', project, investigation, {}, (ctx) => {
        knowledge(ctx);
        ctx.check('investigation changes guidance only', () => assert.deepEqual(code(ctx.after), code(ctx.before)));
        ctx.check('successful guidance write needs no final review', () => assert.equal(ctx.summary.finalReviews, 0));
      });
      if (!reusable || !Object.keys(specs(snapshot(reusable))).length) reusable = project;
    }
    if (wanted('C')) {
      const project = path.join(temp, 'project-C');
      fixture(project, 'auto', { complete: true }, env);
      await task('C', project, 'Read README.md: what command runs the tests and which file contains the accounting acceptance examples?', {}, (ctx) => {
        ctx.check('ordinary query leaves every file unchanged', () => assert.deepEqual(ctx.after, ctx.before));
        ctx.check('ordinary query adds no spec or final review', () => { assert.equal(Object.keys(specs(ctx.after)).length, 0); assert.equal(ctx.summary.finalReviews, 0); });
      });
    }
    if (wanted('D')) {
      const project = path.join(temp, 'project-D');
      fixture(project, 'auto', { complete: true, docs: true }, env);
      await task('D', project, 'Read the authoritative docs/accounting-decisions.md, then rename the local value variable in roundRatioEven to magnitude for clarity. Keep every accounting decision and observable behavior unchanged, and run the tests. Use standard read/edit/write for file changes.', {}, (ctx) => {
        validates(ctx);
        ctx.check('authority and acceptance tests remain byte-identical', () => {
          for (const name of ['docs/accounting-decisions.md', 'tests/money.test.js']) assert.equal(ctx.after[name], ctx.before[name]);
        });
        ctx.check('requested internal refactor actually happened', () => { assert.notEqual(ctx.after['src/money.js'], ctx.before['src/money.js']); assert.match(ctx.after['src/money.js'], /magnitude/); });
        ctx.check('authoritative rationale was actually read', () => assert.ok(ctx.records.some((record) => record.type === 'tool_execution_start' && record.toolName === 'read' && /docs\/accounting-decisions\.md$/.test(record.args.path))));
        ctx.check('no authoritative documentation copy; short reference allowed', () => {
          const body = Object.values(specs(ctx.after)).join('\n');
           assert.ok(body.length <= 1600, 'only a short pointer is justified');
           if (body) assert.match(body, /docs\/accounting-decisions\.md/, 'new routing must refer to the authoritative owner');
          const words = authority.toLowerCase().match(/[a-z0-9]+/g);
          const candidate = (body.toLowerCase().match(/[a-z0-9]+/g) || []).join(' ');
          for (let i = 0; i + 30 <= words.length; i++) assert.ok(!candidate.includes(words.slice(i, i + 30).join(' ')), '30-word authoritative passage copied');
        });
      });
    }
    if (wanted('E')) {
      const project = path.join(temp, 'project-E');
      fixture(project, 'auto', { bug: true, existing: true }, env);
      await task('E', project, 'The existing money tests fail at exact midpoints. Diagnose and fix the implementation regression; this is a bug fix, not a product behavior change. Keep the accepted test cases intact and run them. Use standard read/edit/write for changes.', {}, (ctx) => {
        validates(ctx);
        ctx.check('bug cannot become the contract', () => assert.deepEqual(specs(ctx.after), specs(ctx.before)));
        ctx.check('original tests remain intact', () => assert.equal(ctx.after['tests/money.test.js'], ctx.before['tests/money.test.js']));
      });
    }
    for (const name of ['F1', 'F2']) if (wanted(name)) {
      // Two genuinely fresh Pi processes in the same retained project, with no transcript resume.
      // Prefer A's organic capture; B's model-authored capture is a real fallback, never seeded specs.
      const project = reusable;
      const prompt = name === 'F1' ? 'Add one regression test for quoteFee with a mix of negative and positive adjustments. Preserve all accepted outputs and use standard read/edit/write for changes; run the tests.' :
        'Refactor quoteFee to use an explicit for...of loop instead of reduce, without changing behavior or public exports. If it already uses a loop, rename its local accumulator to settledTotal. Use standard read/edit/write for changes and run the tests.';
      await task(name, project, prompt, {}, (ctx) => {
        validates(ctx);
        json(path.join(ctx.dir, 'reuse-source.json'), { project, sourceTask: path.basename(project).slice('project-'.length) });
        ctx.check('earlier organic task produced real reusable knowledge', () => assert.ok(Object.keys(specs(ctx.before)).length > 0));
        ctx.check('fresh independent session, not a resumed transcript', () => {
          assert.ok(ctx.summary.sessionId);
          assert.ok(results.every((result) => result.sessionId !== ctx.summary.sessionId));
          assert.equal(ctx.data.messages.filter((message) => message.role === 'user').length, 1);
        });
        ctx.check('fresh session received full knowledge and automatic routing recognized it', () => {
          const documents = Object.entries(specs(ctx.before));
          const toolResults = ctx.data.messages.filter((message) => message.role === 'toolResult');
          assert.ok(documents.some(([file, body]) => {
            const received = toolResults.some((message) => text(message).includes(body));
            const routed = toolResults.some((message) => {
              const call = ctx.summary.tools.find((record) => record.type === 'tool_execution_start' && record.toolCallId === message.toolCallId);
              return /src\/money\.js$|tests\/money\.test\.js$/.test(call?.args?.path || '') &&
                text(message).includes('[Charterleaf]') && (text(message).includes(`--- ${file} (project constraints`) ||
                  text(message).includes(`${file} is already supplied in this tool batch`));
            });
            // Explicit full reads may beat automatic delivery in a sibling batch; both are valid reuse.
            return received && routed;
          }));
        });
        ctx.check('knowledge reused without duplication or rewriting', () => assert.deepEqual(specs(ctx.after), specs(ctx.before)));
        ctx.check('real task change, no redundant semantic review', () => { assert.notDeepEqual(code(ctx.after), code(ctx.before)); assert.equal(ctx.summary.finalReviews, 0); });
      });
    }
    for (const [name, mode, approve] of [['G-auto', 'auto'], ['G-confirm-yes', 'confirm', true], ['G-confirm-no', 'confirm', false], ['G-reference', 'reference'], ['G-read-only', 'auto'], ['G-no-ui', 'confirm'], ['G-confirm-no-probe', 'confirm', false], ['G-no-ui-probe', 'confirm']]) {
      if (!wanted(name)) continue;
      const project = path.join(temp, `project-${name}`);
      const readOnly = name === 'G-read-only';
      const noUI = name.includes('no-ui');
      const probe = name.endsWith('-probe');
      // Use the same ordinary investigation as B for approval coverage, not a prompt demanding specs.
      const investigate = mode === 'confirm';
      fixture(project, mode, { complete: readOnly || investigate }, env);
      const prompt = readOnly ? 'Read src/money.js and tests/money.test.js and explain the exact tie handling and per-line accounting boundary. This task is strictly read-only: do not create, edit or delete any file, including project guidance.' : probe ? 'Create a brief scoped engineering spec for the accepted per-line fee settlement boundary evidenced in src/money.js and tests/money.test.js. Reference the authoritative acceptance cases instead of copying them. Submit the exact file content with standard write/edit; the saved mode still governs approval. Do not change code, tests or mode configuration.' : investigate ? investigation : development;
      await task(name, project, prompt, { approve, noUI }, (ctx) => {
        validates(ctx);
        if (investigate) ctx.check('approval investigation preserves code and authoritative tests', () => assert.deepEqual(code(ctx.after), code(ctx.before)));
        if (mode === 'auto' && !readOnly || approve) knowledge(ctx);
        else ctx.check('protected guidance not written', () => assert.deepEqual(specs(ctx.after), specs(ctx.before)));
        if (mode === 'reference') ctx.check('Reference reports a durable constraint proposal while editing code normally', () => {
          const reply = ctx.data.messages.filter((message) => message.role === 'assistant').map(text).join('\n');
          assert.match(reply, /propos|spec|guidance|invariant|constraint/i);
          assert.match(reply, LINE_BOUNDARY);
        });
        if (readOnly) ctx.check('explicit read-only request fully respected; no final review', () => { assert.deepEqual(ctx.after, ctx.before); assert.equal(ctx.summary.finalReviews, 0); });
        if (mode === 'confirm' && !noUI) {
          ctx.check('real native per-write approval dialog exercised', () => {
            assert.ok(ctx.summary.approvals.length > 0);
            assert.ok(ctx.summary.approvals.every((record) => /^Charterleaf: modify specs\//.test(record.title)));
          });
          if (!approve) ctx.check('denied proposals do not reopen identical approval', () => {
            const proposals = ctx.summary.approvals.map((record) => `${record.title}\n${record.message}`);
            assert.equal(new Set(proposals).size, proposals.length);
            assert.ok(ctx.data.messages.some((message) => message.role === 'toolResult' && message.isError && /not approved|refused/i.test(text(message))));
          });
        }
        if (noUI) ctx.check('genuine no-UI Confirm denies a real write attempt without a dialog', () => {
          assert.equal(ctx.summary.approvals.length, 0);
          assert.ok(ctx.data.messages.some((message) => message.role === 'toolResult' && message.isError && /requires interactive approval/i.test(text(message))));
        });
      });
    }
  } catch (error) {
    json(path.join(temp, 'setup-error.json'), { error: error.message });
    throw error;
  } finally {
    if (discovery) await discovery.stop();
    removePrivateCopies();
    json(path.join(temp, 'results.json'), results);
    console.log(`Retained evidence: ${temp}`);
  }
  if (results.some((result) => !result.pass)) process.exitCode = 1;
}
main().catch((error) => { console.error(`Organic smoke failed: ${error.message}`); process.exitCode = 1; });
