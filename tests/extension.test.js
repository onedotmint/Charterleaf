'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const charterleaf = require('../extensions/charterleaf.js');
const {
  CONFIG, projectRoot, projectPath, modeConfigPath, isModeConfig, readMode, saveMode, fingerprint, gitSnapshot, changedSince,
} = require('../lib/project.js');

const SPEC = 'specs/capabilities/service.md';
const SOURCE = 'src/service.js';
const CONTRACT = `---
id: service.contract
applies_to:
  - src/**
---
# Service contract

## Requirements

### SERVICE-001 — Durable boundary
The service MUST preserve the public return shape.
`;
const GLOBAL = '# Constitution\nNever expose credentials.\n';

function project(t, { mode = 'auto', git = false, specs = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-extension-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = {
    root,
    file: (name) => path.join(root, name),
    write(name, text) {
      fs.mkdirSync(path.dirname(this.file(name)), { recursive: true });
      fs.writeFileSync(this.file(name), text);
    },
    read(name) { return fs.readFileSync(this.file(name), 'utf8'); },
    git(...args) {
      return execFileSync('git', ['-C', root, ...args], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
  };
  p.write(SOURCE, 'module.exports = 1;\n');
  if (specs) {
    p.write('specs/constitution.md', GLOBAL);
    p.write(SPEC, CONTRACT);
  }
  if (mode !== null) saveMode(root, mode);
  if (git) {
    p.git('init', '--quiet');
    p.git('add', '.');
    p.git('-c', 'user.name=Extension Test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline');
  }
  return p;
}

// Only Pi's event/UI boundary is mocked. Routing, lint, hashes and Git run for real.
function api(p, { hasUI = true } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const selections = [];
  const approvals = [];
  const notifications = [];
  let nextId = 0;
  const h = {
    ctx: {
      cwd: p.root, hasUI,
      ui: {
        select: async (...args) => { selections.push(args); return h.select(...args); },
        confirm: async (...args) => { approvals.push(args); return h.confirm(...args); },
        notify: (...args) => notifications.push(args),
      },
    },
    selections, approvals, notifications, commands,
    select: () => undefined,
    confirm: () => false,
    async emit(name, event = {}, ctx = this.ctx) {
      assert.ok(handlers.has(name), `extension must register ${name}`);
      return handlers.get(name)(event, ctx);
    },
    menu() { return commands.get('charterleaf').handler('', this.ctx); },
    call(toolName, input, toolCallId = `call-${++nextId}`) {
      return { toolName, input, toolCallId };
    },
    result(call, overrides = {}) {
      return this.emit('tool_result', {
        ...call, isError: false, content: [{ type: 'text', text: 'tool succeeded' }], ...overrides,
      });
    },
    async read(name = SOURCE, options = {}) {
      const call = this.call('read', { path: name, ...options });
      const block = await this.emit('tool_call', call);
      assert.equal(block, undefined);
      const content = [{ type: 'text', text: p.read(name) }];
      return this.result(call, { content });
    },
    async write(name, content) {
      const call = this.call('write', { path: name, content });
      const block = await this.emit('tool_call', call);
      if (block) return block;
      p.write(name, content);
      return this.result(call);
    },
    async prime() { await this.read(); await this.emit('context'); },
    assistant(content, overrides = {}) {
      return this.emit('message_end', { message: {
        role: 'assistant', content: [{ type: 'text', text: content }], stopReason: 'stop', ...overrides,
      } });
    },
    settle(overrides = {}) {
      return this.emit('agent_before_settle', {
        outcome: 'completed', context: { canContinue: true }, entries: [], ...overrides,
      });
    },
  };
  charterleaf({
    on(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
  });
  return h;
}

function text(result) {
  return result?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n') || '';
}

function numberedPage(body, offset = 1, limit = 2000) {
  const lines = body.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const page = lines.slice(offset - 1, offset - 1 + limit);
  const width = String(offset + page.length - 1).length;
  return page.map((line, i) => `${String(offset + i).padStart(width)}: ${line}`).join('\n') + '\n';
}

function review(result) {
  assert.equal(result.continue, true);
  const entry = result.entries.at(-1);
  assert.equal(entry.type, 'custom_message');
  assert.equal(entry.customType, 'charterleaf');
  assert.equal(entry.display, false);
  return entry.content;
}

function pathsInReview(content, label) {
  const line = content.split('\n').find((value) => value.startsWith(label));
  assert.ok(line, `missing review line ${label}`);
  return JSON.parse(line.slice(line.indexOf(': ') + 2, line.indexOf('].') + 1));
}

const OWNED = 'Successful standard tool edits still unchanged at settlement';
const UNATTRIBUTED = 'Observed worktree changes NOT attributable to this agent';

test('disabled: all lifecycle/tool events stay quiet and never create adoption files', async (t) => {
  const p = project(t, { mode: null, specs: false });
  const h = api(p);
  await h.emit('session_start');
  assert.equal(await h.emit('before_agent_start'), undefined);
  for (const toolName of ['read', 'write', 'edit', 'bash', 'powershell']) {
    const call = h.call(toolName, { path: SOURCE });
    assert.equal(await h.emit('tool_call', call), undefined);
    assert.equal(await h.result(call), undefined);
  }
  await h.emit('context');
  assert.equal(await h.settle(), undefined);
  for (const name of ['session_compact', 'session_switch', 'session_tree', 'session_shutdown']) {
    assert.equal(await h.emit(name), undefined);
  }
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(h.approvals, []);
  assert.deepEqual(h.selections, []);
  assert.equal(fs.existsSync(p.file('specs')), false);
});

test('menu: first enable, switch, disable, restore and cancel preserve project documents', async (t) => {
  const p = project(t, { mode: null });
  const h = api(p);
  assert.equal(h.commands.size, 1);
  const choose = async (index) => {
    h.select = (_title, options) => options[index];
    await h.menu();
  };
  await choose(0);
  assert.equal(readMode(p.root), 'auto');
  assert.match(h.selections[0][0], /Charterleaf — off \(not configured\)/);
  assert.match(h.selections[0][0], /no automatic constraint loading or code edit checks/);
  assert.match(h.selections[0][0], /Existing specs do not enable automation; choose a mode/);
  assert.match(h.notifications.at(-1)[0], /auto — Automatic constraint loading and code edit checks; maintain only justified durable specs/);
  assert.ok(h.selections[0][0].includes(p.root));
  assert.equal(h.selections[0][1].length, 4);
  for (const [index, mode] of [[1, 'confirm'], [2, 'reference'], [3, 'off'], [0, 'auto']]) {
    await choose(index);
    assert.equal(readMode(p.root), mode);
    const expected = {
      confirm: /approve each spec modification/,
      reference: /never modify specs/,
      off: /no automatic constraint loading or code edit checks; existing documents preserved/,
      auto: /maintain only justified durable specs/,
    };
    assert.match(h.notifications.at(-1)[0], expected[mode]);
    assert.ok(h.notifications.at(-1)[0].includes(`saved to ${modeConfigPath(p.root)}`));
    assert.equal(p.read(SPEC), CONTRACT);
    assert.equal(p.read('specs/constitution.md'), GLOBAL);
  }
  const config = p.read(CONFIG);
  h.select = () => undefined;
  await h.menu();
  assert.equal(p.read(CONFIG), config);
  assert.equal(h.notifications.length, 5);
  assert.ok(h.notifications.every(([, level]) => level === 'info'));
  const restored = api(p);
  await restored.emit('session_start');
  assert.match((await restored.emit('before_agent_start')).message.content, /mode=auto/);
});

test('menu: cancel and Not Enable on an unconfigured project create nothing', async (t) => {
  const p = project(t, { mode: null, specs: false });
  const h = api(p);
  await h.menu();
  h.select = (_title, options) => options[3];
  await h.menu();
  assert.equal(fs.existsSync(p.file('specs')), false);
  assert.deepEqual(h.notifications, []);
});

test('menu: saved off is distinct from unconfigured without enabling or scanning specs', async (t) => {
  const p = project(t, { mode: 'off' });
  p.write(SPEC, '{invalid spec metadata does not prevent the mode menu');
  const before = p.read(CONFIG);
  const h = api(p);
  await h.emit('session_start');
  assert.deepEqual(h.selections, []);
  assert.deepEqual(h.notifications, []);
  await h.menu();
  assert.match(h.selections[0][0], /off \(disabled\)/);
  assert.doesNotMatch(h.selections[0][0], /not configured/);
  assert.match(h.selections[0][0], /Existing specs do not enable automation/);
  assert.equal(p.read(CONFIG), before);
  assert.deepEqual(h.notifications, []);
});

test('menu: invalid config is disabled and can be repaired; UI exceptions are reported', async (t) => {
  const p = project(t);
  p.write(CONFIG, '{broken');
  const h = api(p);
  await h.emit('session_start');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
  assert.equal(await h.emit('before_agent_start'), undefined);
  assert.match(h.notifications.at(-1)[0], /disabled/i);
  h.select = (title, options) => { assert.match(title, /invalid config/); return options[2]; };
  await h.menu();
  assert.equal(readMode(p.root), 'reference');
  h.select = () => { throw new Error('selection unavailable'); };
  await h.menu();
  assert.deepEqual(h.notifications.at(-1), ['Charterleaf: selection unavailable', 'warning']);
});

test('no UI: menu is silent, Auto still injects, Confirm blocks, Reference blocks', async (t) => {
  const p = project(t);
  const h = api(p, { hasUI: false });
  await h.menu();
  assert.deepEqual(h.selections, []);
  assert.match((await h.emit('before_agent_start')).message.content, /mode=auto/);
  assert.match(text(await h.read()), /SERVICE-001/);
  saveMode(p.root, 'confirm');
  assert.match((await h.write(SPEC, CONTRACT)).reason, /requires interactive approval/);
  saveMode(p.root, 'reference');
  assert.match((await h.write(SPEC, CONTRACT)).reason, /Reference mode/);
  assert.deepEqual(h.approvals, []);
  assert.deepEqual(h.notifications, []);
});

for (const mode of ['auto', 'confirm', 'reference']) {
  test(`${mode}: spec mutation permissions, exact approval and structural-only lint`, async (t) => {
    const p = project(t, { mode });
    const h = api(p);
    h.confirm = () => true;
    const updated = CONTRACT.replace('public return shape', 'public return shape and error type');
    const result = await h.write(SPEC, updated);
    if (mode === 'reference') {
      assert.equal(result.block, true);
      assert.match(result.reason, /never|do not modify specs/);
      assert.equal(p.read(SPEC), CONTRACT);
    } else {
      assert.equal(p.read(SPEC), updated);
      assert.match(text(result), /structural check \(not semantic verification\)/);
      assert.match(text(result), /0 structural errors/);
    }
    assert.equal(h.approvals.length, mode === 'confirm' ? 1 : 0);
    if (mode === 'confirm') {
      const [title, proposal, options] = h.approvals[0];
      assert.ok(title.includes(SPEC));
      assert.ok(proposal.includes(JSON.stringify({ path: p.file(SPEC), content: updated }, null, 2)));
      assert.match(proposal, /Never relax a spec just to match conflicting code/);
      assert.deepEqual(options, { timeout: 60000 });
      const edit = h.call('edit', { path: SPEC, oldText: 'error type', newText: 'error contract' });
      assert.equal(await h.emit('tool_call', edit), undefined);
      p.write(SPEC, updated.replace('error type', 'error contract'));
      assert.match(text(await h.result(edit)), /structural check/);
      assert.equal(h.approvals.length, 2, 'approval is per operation, not a session grant');
    }
    for (const toolName of ['write', 'edit']) {
      const result = await h.emit('tool_call', h.call(toolName, { path: CONFIG, content: '{}' }));
      assert.equal(result.block, true);
      assert.match(result.reason, /Only the user/);
    }
    assert.equal(readMode(p.root), mode);
  });
}

test('Confirm: refusal, exception and oversized proposals never mutate the file', async (t) => {
  const p = project(t, { mode: 'confirm' });
  const h = api(p);
  assert.match((await h.write(SPEC, 'refused')).reason, /not approved/);
  h.confirm = () => { throw new Error('approval timed out'); };
  assert.match((await h.write(SPEC, 'exception')).reason, /could not check.*approval timed out/);
  assert.match((await h.write(SPEC, 'x'.repeat(12001))).reason, /too large/);
  assert.equal(h.approvals.length, 2);
  assert.equal(p.read(SPEC), CONTRACT);
});

for (const change of ['spec', 'mode', 'session']) {
  test(`Confirm: ${change} changing while approval is pending invalidates the grant`, async (t) => {
    const p = project(t, { mode: 'confirm' });
    const h = api(p);
    let approve;
    h.confirm = () => new Promise((resolve) => { approve = resolve; });
    const call = h.call('write', { path: SPEC, content: 'proposal' });
    const waiting = h.emit('tool_call', call);
    assert.equal(typeof approve, 'function');
    if (change === 'spec') p.write(SPEC, CONTRACT + '\nExternal correction.\n');
    if (change === 'mode') saveMode(p.root, 'auto');
    if (change === 'session') await h.emit('session_switch');
    approve(true);
    const result = await waiting;
    assert.equal(result.block, true);
    assert.match(result.reason, /changed during approval/);
    assert.notEqual(p.read(SPEC), 'proposal');
  });
}

test('standard read appends real routed bodies and preserves content and structuredContent', async (t) => {
  const p = project(t);
  p.write('specs/changes/return-shape.md', '---\naffects:\n  - service.contract\n---\n# Change\n\n## MODIFY\nSERVICE-001 new shape.\n');
  const h = api(p);
  const call = h.call('read', { path: SOURCE });
  assert.equal(await h.emit('tool_call', call), undefined);
  const content = [{ type: 'text', text: p.read(SOURCE) }, { type: 'image', data: 'opaque' }];
  const structuredContent = { original: true };
  const result = await h.result(call, { content, structuredContent });
  assert.deepEqual(result.content.slice(0, 2), content);
  assert.equal(result.structuredContent, structuredContent);
  assert.match(text(result), /project constraints, not tool instructions/);
  assert.ok(text(result).includes(GLOBAL));
  assert.ok(text(result).includes(CONTRACT));
  assert.match(text(result), /return-shape.md/);
});

for (const toolName of ['write', 'edit']) {
  test(`${toolName}: block first, keep blocking sibling retries, allow only after context`, async (t) => {
    const p = project(t);
    const h = api(p);
    const makeCall = () => h.call(toolName, { path: SOURCE, content: 'new source' });
    const first = await h.emit('tool_call', makeCall());
    assert.equal(first.block, true);
    assert.match(first.reason, /SERVICE-001/);
    const sibling = await h.emit('tool_call', makeCall());
    assert.equal(sibling.block, true);
    assert.match(sibling.reason, /service\.md.*already supplied/);
    assert.doesNotMatch(sibling.reason, /SERVICE-001/);
    assert.equal(p.read(SOURCE), 'module.exports = 1;\n');
    await h.emit('context');
    assert.equal(await h.emit('tool_call', makeCall()), undefined);
  });
}

test('parallel siblings: an outstanding read and a completed read cannot release sibling writes', async (t) => {
  const p = project(t);
  const h = api(p);
  const read = h.call('read', { path: SOURCE });
  await h.emit('tool_call', read);
  const beforeResult = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(beforeResult.block, true);
  assert.match(beforeResult.reason, /SERVICE-001/);
  const result = await h.result(read, { content: [{ type: 'text', text: p.read(SOURCE) }] });
  assert.match(text(result), /already supplied/);
  assert.doesNotMatch(text(result), /SERVICE-001/, 'only one spec body per batch');
  const siblings = await Promise.all(['write', 'edit'].map((toolName) =>
    h.emit('tool_call', h.call(toolName, { path: 'src/sibling.js' }))));
  assert.ok(siblings.every((value) => value.block === true));
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: 'src/sibling.js' })), undefined);
});

test('routing miss is honest metadata-only; routed bodies and miss notices deduplicate after context', async (t) => {
  const p = project(t);
  const h = api(p);
  p.write('docs/unmatched.txt', 'document');
  const miss = text(await h.read('docs/unmatched.txt'));
  assert.match(miss, /No applies_to glob matched this path/);
  assert.match(miss, /not proof that no constraints apply/);
  assert.match(miss, /service.contract: specs\/capabilities\/service.md \[src\/\*\*\]/);
  assert.ok(miss.includes(GLOBAL));
  assert.ok(!miss.includes('The service MUST'), 'available list must not inject unmatched bodies');
  await h.emit('context');
  assert.equal(await h.read('docs/unmatched.txt'), undefined);
  assert.match(text(await h.read()), /SERVICE-001/);
  await h.emit('context');
  assert.equal(await h.read(), undefined);
});

test('project switch does not reuse constraints, approvals, or edit ownership from another project', async (t) => {
  const a = project(t);
  const b = project(t, { mode: 'reference' });
  b.write(SPEC, CONTRACT.replace('public return shape', 'B-only contract'));
  const h = api(a);
  await h.prime();
  await h.write(SOURCE, 'A edit');
  h.ctx.cwd = b.root;
  const result = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(result.block, true);
  assert.match(result.reason, /B-only contract/);
  assert.doesNotMatch(result.reason, /public return shape/);
  assert.equal(await h.settle(), undefined);
  saveMode(b.root, 'off');
  assert.equal(await h.emit('before_agent_start'), undefined);
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

for (const event of ['session_compact', 'session_switch', 'session_tree', 'session_shutdown']) {
  test(`${event}: the model must receive constraints again`, async (t) => {
    const p = project(t);
    const h = api(p);
    await h.prime();
    assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
    await h.emit(event);
    assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
  });
}

for (const options of [{ offset: 1 }, { limit: 20 }, { startLine: 1 }, { endLine: 20 }]) {
  test(`partial spec read ${JSON.stringify(options)} does not count as complete`, async (t) => {
    const p = project(t);
    p.write(SPEC, CONTRACT + 'x'.repeat(8100));
    const h = api(p);
    await h.read('specs/constitution.md');
    const call = h.call('read', { path: SPEC, ...options });
    await h.emit('tool_call', call);
    await h.result(call, { content: [{ type: 'text', text: p.read(SPEC).split('\n').slice(0, 5).join('\n') }] });
    await h.emit('context');
    const result = await h.emit('tool_call', h.call('write', { path: SOURCE }));
    assert.equal(result.block, true);
    assert.match(result.reason, /Read the complete.*automatic context budget reached/);
  });
}

test('large spec: truncated read does not grant access; full read grants it only after context', async (t) => {
  const p = project(t);
  p.write(SPEC, CONTRACT + 'x'.repeat(8100));
  const h = api(p);
  await h.read('specs/constitution.md');
  const call = h.call('read', { path: SPEC });
  await h.emit('tool_call', call);
  await h.result(call, { details: { truncation: { truncated: true } }, content: [{ type: 'text', text: 'Output truncated; use offset' }] });
  await h.emit('context');
  assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
  await h.read(SPEC);
  assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('spec edits invalidate route cache, and external content changes require fresh context', async (t) => {
  const p = project(t);
  const h = api(p);
  await h.prime();
  const updated = CONTRACT.replace('public return shape', 'new durable contract');
  await h.write(SPEC, updated);
  const blocked = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.match(blocked.reason, /new durable contract/);
  await h.emit('context');
  p.write(SPEC, updated.replace('new durable contract', 'external contract'));
  assert.match((await h.emit('tool_call', h.call('write', { path: SOURCE }))).reason, /external contract/);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('malformed routing fails closed for mutations and annotates read errors without altering original content', async (t) => {
  const p = project(t);
  p.write(SPEC, '---\nid: bad\napplies_to: not-a-list\n---\n# Invalid\n');
  const h = api(p);
  const block = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(block.block, true);
  assert.match(block.reason, /could not check.*applies_to/s);
  assert.match(block.reason, /No modification was executed.*Do not bypass.*Report the task as blocked/s);
  const result = await h.read();
  assert.equal(result.content[0].text, p.read(SOURCE));
  assert.match(text(result), /check failed.*Do not assume constraints were verified/s);
});

for (const mode of ['auto', 'confirm', 'reference']) {
  test(`${mode}: one final review contains conflict discipline and long-lived contracts, not semantic verdicts`, async (t) => {
    const p = project(t, { mode });
    const h = api(p);
    await h.emit('before_agent_start');
    await h.prime();
    await h.write(SOURCE, 'module.exports = { changed: true };\n');
    const existing = { type: 'assistant', content: 'finished' };
    const result = await h.settle({ entries: [existing] });
    assert.equal(result.entries[0], existing);
    const content = review(result);
    assert.deepEqual(pathsInReview(content, OWNED), [SOURCE]);
    assert.match(content, /once only/);
    assert.match(content, /No justified durable knowledge means no spec edit/);
    assert.match(content, /newly established AND newly discovered/);
    assert.match(content, /no code change is required/);
    assert.match(content, /Honor explicit no-file-write\/read-only instructions/);
    assert.match(content, /non-obvious contracts, invariants, boundaries, pitfalls or accepted decisions/);
    assert.match(content, /not permission to rewrite the spec/);
    assert.match(content, /implementation bug, obsolete spec and explicitly intended contract change/);
    assert.match(content, /If uncertain, preserve the spec/);
    assert.match(content, /routing hints only/);
    assert.match(content, mode === 'reference' ? /never write specs/ :
      mode === 'confirm' ? /obtain approval before execution/ : /only when durable knowledge is justified/);
    assert.equal(p.read(SPEC), CONTRACT, 'review itself never fabricates a semantic decision or edits a spec');
    assert.equal(await h.settle(), undefined);
  });
}

test('settlement: error/abort never review; a completed assistant answer can receive one review', async (t) => {
  const p = project(t);
  const h = api(p);
  await h.prime();
  await h.write(SOURCE, 'changed');
  for (const outcome of ['error', 'aborted']) assert.equal(await h.settle({ outcome }), undefined);
  // Real Pi previews false after a final assistant answer, before our custom message is appended.
  review(await h.settle({ context: { canContinue: false } }));
  assert.equal(await h.settle(), undefined);
});

test('no actual change: successful no-op write and reads alone do not trigger final review', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.prime();
  await h.write(SOURCE, p.read(SOURCE));
  assert.equal(await h.settle(), undefined);
  assert.equal(p.read(SPEC), CONTRACT);
});

test('Git: pre-existing dirty content is excluded; parallel changed files stay unattributed', async (t) => {
  const p = project(t, { git: true });
  p.write('user-existing.txt', 'pre-existing untracked');
  p.write(SOURCE, 'pre-existing dirty source');
  const h = api(p);
  await h.emit('before_agent_start');
  await h.prime();
  await h.write(SOURCE, 'agent source on top of existing dirty');
  p.write('parallel.txt', 'another session');
  const content = review(await h.settle());
  assert.deepEqual(pathsInReview(content, OWNED), [SOURCE]);
  assert.deepEqual(pathsInReview(content, UNATTRIBUTED), ['parallel.txt']);
  assert.match(content, /user or a parallel session/);
  assert.match(content, /Existing dirty content is not yours/);
  assert.doesNotMatch(content, /user-existing.txt/);
  assert.equal(p.read(SPEC), CONTRACT);
});

test('Git: a previously dirty file changed externally is observed but never claimed', async (t) => {
  const p = project(t, { git: true });
  p.write(SOURCE, 'user dirty');
  const h = api(p);
  await h.emit('before_agent_start');
  p.write(SOURCE, 'parallel modification of dirty file');
  assert.equal(await h.settle(), undefined, 'read-only activity must not manufacture a review for another session');
  await h.emit('before_agent_start');
  p.write(SOURCE, 'another parallel modification');
  await h.result(h.call('external_writer', {}));
  const content = review(await h.settle());
  assert.deepEqual(pathsInReview(content, OWNED), []);
  assert.deepEqual(pathsInReview(content, UNATTRIBUTED), [SOURCE]);
});

test('external replacement of an agent edit removes ownership at settlement', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.prime();
  await h.write(SOURCE, 'agent version');
  p.write(SOURCE, 'external version');
  const content = review(await h.settle());
  assert.deepEqual(pathsInReview(content, OWNED), []);
  assert.deepEqual(pathsInReview(content, UNATTRIBUTED), [SOURCE]);
});

test('failed standard tool is never credited; real partial changes are unattributed', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.prime();
  const call = h.call('write', { path: SOURCE, content: 'partially written' });
  assert.equal(await h.emit('tool_call', call), undefined);
  p.write(SOURCE, 'partially written');
  assert.equal(await h.result(call, { isError: true }), undefined);
  const content = review(await h.settle());
  assert.deepEqual(pathsInReview(content, OWNED), []);
  assert.deepEqual(pathsInReview(content, UNATTRIBUTED), [SOURCE]);
});

test('failed read grants no constraints; unmatched result IDs never claim standard mutations', async (t) => {
  const p = project(t);
  const h = api(p);
  const read = h.call('read', { path: SOURCE });
  await h.emit('tool_call', read);
  assert.equal(await h.result(read, { isError: true }), undefined);
  assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
  await h.emit('context');
  await h.result(h.call('write', { path: SOURCE, content: 'not executed' }));
  assert.equal(await h.settle(), undefined);
});

for (const toolName of ['bash', 'powershell']) {
  test(`no Git: successful ${toolName} triggers conservative review without invented ownership`, async (t) => {
    const p = project(t);
    const h = api(p);
    await h.emit('before_agent_start');
    assert.equal(gitSnapshot(p.root), null);
    const call = h.call(toolName, { command: 'opaque work' });
    assert.equal(await h.emit('tool_call', call), undefined);
    await h.result(call);
    const content = review(await h.settle());
    assert.deepEqual(pathsInReview(content, OWNED), []);
    assert.deepEqual(pathsInReview(content, UNATTRIBUTED), []);
    assert.match(content, /Git change inspection unavailable/);
    assert.match(content, /Review only evidence in this conversation/);
  });
}

test('no Git: failed opaque tools and external-only changes do not invent a change signal', async (t) => {
  const p = project(t);
  const h = api(p);
  await h.emit('before_agent_start');
  await h.result(h.call('bash', { command: 'failed' }), { isError: true });
  p.write(SOURCE, 'external, not observable without Git');
  assert.equal(await h.settle(), undefined);
});

test('Git: successful read-only Bash with no diff does not manufacture a final review', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.result(h.call('bash', { command: 'git status' }));
  assert.equal(await h.settle(), undefined);
});

test('final routing error reports the limit, preserves entries/specs, and never retries', async (t) => {
  const p = project(t);
  const h = api(p);
  await h.prime();
  await h.write(SOURCE, 'changed');
  p.write(SPEC, '---\napplies_to: invalid\n---\n');
  const entry = { type: 'assistant', content: 'original' };
  const result = await h.settle({ entries: [entry] });
  assert.equal(result.entries[0], entry);
  assert.equal(result.continue, undefined);
  assert.match(result.entries.at(-1).content, /No automatic review was performed; preserve existing specs/);
  assert.match(h.notifications.at(-1)[0], /final review skipped/);
  assert.equal(await h.settle(), undefined);
  assert.equal(p.read(SPEC), '---\napplies_to: invalid\n---\n');
});

test('project helpers: root discovery uses Git/config ancestors, including Git worktree markers', (t) => {
  const p = project(t);
  fs.mkdirSync(p.file('src/deep'), { recursive: true });
  assert.equal(projectRoot(p.file('src/deep')), p.root);
  fs.rmSync(p.file(CONFIG));
  p.write('.git', 'gitdir: /not-needed-for-root-detection\n');
  assert.equal(projectRoot(p.file('src/deep')), p.root);
  fs.rmSync(p.file('.git'));
  assert.equal(projectRoot(p.file('src/deep')), p.file('src/deep'));
});

test('project helpers: config validation, atomic persistence, and off preserve spec files', (t) => {
  const p = project(t, { mode: null });
  assert.equal(readMode(p.root), 'off');
  for (const mode of ['auto', 'confirm', 'reference', 'off']) {
    saveMode(p.root, mode);
    assert.equal(readMode(p.root), mode);
    assert.deepEqual(JSON.parse(p.read(CONFIG)), { version: 1, mode });
    assert.equal(p.read(SPEC), CONTRACT);
    assert.deepEqual(fs.readdirSync(p.file('specs')).filter((name) => name.endsWith('.tmp')), []);
  }
  assert.throws(() => saveMode(p.root, 'anything'), /Invalid Charterleaf mode/);
  for (const config of ['{', '{"version":2,"mode":"auto"}', '{"version":1,"mode":"unsafe"}']) {
    p.write(CONFIG, config);
    assert.throws(() => readMode(p.root));
  }
});

for (const variable of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE']) {
  test(`Git mode: inherited ${variable} cannot read, change or migrate another repository's authorization`, (t) => {
    const p = project(t, { git: true, mode: null });
    const other = project(t, { git: true, mode: null });
    saveMode(p.root, 'off');
    saveMode(other.root, 'auto');
    const local = modeConfigPath(p.root);
    const foreign = modeConfigPath(other.root);
    const before = fs.readFileSync(foreign, 'utf8');
    const previous = process.env[variable];
    process.env[variable] = variable === 'GIT_WORK_TREE' ? other.root : other.file('.git');
    try {
      assert.equal(modeConfigPath(p.root), local);
      assert.equal(readMode(p.root), 'off');
      saveMode(p.root, 'reference');
      assert.equal(fs.readFileSync(foreign, 'utf8'), before);
      fs.unlinkSync(local);
      fs.unlinkSync(foreign);
      p.write(CONFIG, JSON.stringify({ version: 1, mode: 'confirm' }));
      assert.equal(readMode(p.root), 'confirm');
      assert.equal(fs.existsSync(foreign), false, 'migration must not write foreign Git metadata');
    } finally {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    }
  });
}

test('Git mode: nested legacy Auto cannot override repository off or keep mode branch-local', async (t) => {
  const p = project(t, { git: true, mode: null });
  saveMode(p.root, 'off');
  p.write(`packages/app/${CONFIG}`, JSON.stringify({ version: 1, mode: 'auto' }));
  const nested = p.file('packages/app');
  const before = p.read(`packages/app/${CONFIG}`);
  assert.equal(projectRoot(nested), p.root);
  assert.equal(readMode(projectRoot(nested)), 'off');
  const h = api(p);
  h.ctx.cwd = nested;
  assert.equal(await h.emit('before_agent_start'), undefined);
  h.select = (_title, options) => options[2];
  await h.menu();
  assert.equal(readMode(p.root), 'reference');
  assert.equal(p.read(`packages/app/${CONFIG}`), before);
});

for (const mode of ['auto', 'confirm', 'reference', 'off']) {
  test(`Git mode: migrates legacy ${mode} without changing the worktree`, (t) => {
    const p = project(t, { git: true, mode: null });
    p.write(CONFIG, JSON.stringify({ version: 1, mode }) + '\n');
    const before = p.git('status', '--porcelain');
    const legacy = p.read(CONFIG);
    assert.equal(readMode(p.root), mode);
    assert.equal(modeConfigPath(p.root), p.file('.git/charterleaf.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(modeConfigPath(p.root), 'utf8')), { version: 1, mode });
    assert.equal(p.read(CONFIG), legacy);
    assert.equal(p.git('status', '--porcelain'), before);
    fs.unlinkSync(p.file(CONFIG));
    assert.equal(readMode(p.root), mode);
    p.write(CONFIG, '{invalid stale branch config');
    assert.equal(readMode(p.root), mode, 'local choice takes precedence over branch files');
  });
}

test('Git mode: migration cannot overwrite a concurrent explicit off choice', (t) => {
  const p = project(t, { git: true, mode: null });
  p.write(CONFIG, JSON.stringify({ version: 1, mode: 'auto' }));
  const link = fs.linkSync;
  fs.linkSync = (temporary, target) => {
    saveMode(p.root, 'off');
    return link(temporary, target);
  };
  try { assert.equal(readMode(p.root), 'off'); }
  finally { fs.linkSync = link; }
  assert.equal(readMode(p.root), 'off');
  assert.deepEqual(fs.readdirSync(p.file('.git')).filter((name) => name.endsWith('.tmp')), []);
});

test('Git mode: invalid legacy/local configs and escaping symlinks never authorize migration', (t) => {
  const p = project(t, { git: true, mode: null });
  const file = modeConfigPath(p.root);
  p.write(CONFIG, '{broken');
  assert.throws(() => readMode(p.root));
  assert.equal(fs.existsSync(file), false);
  p.write(CONFIG, JSON.stringify({ version: 1, mode: 'auto' }));
  fs.writeFileSync(file, '{broken');
  assert.throws(() => readMode(p.root), 'invalid local choice cannot fall back to legacy Auto');
  const outside = project(t);
  fs.unlinkSync(file);
  fs.symlinkSync(outside.file(CONFIG), file);
  const before = outside.read(CONFIG);
  assert.throws(() => readMode(p.root), /escapes project storage/);
  assert.throws(() => saveMode(p.root, 'off'), /escapes project storage/);
  assert.equal(outside.read(CONFIG), before);
});

test('Git mode: real branch switches preserve authorization but load current branch constraints', async (t) => {
  const p = project(t, { git: true });
  const original = p.git('branch', '--show-current').trim();
  const h = api(p);
  await h.prime();
  assert.equal(readMode(p.root), 'auto');
  p.git('checkout', '--quiet', '-b', 'without-legacy-mode');
  p.git('rm', '--quiet', CONFIG);
  p.write(SPEC, CONTRACT.replace('public return shape', 'new branch error contract'));
  p.git('add', SPEC);
  p.git('-c', 'user.name=Mode Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Different branch contracts');
  assert.equal(fs.existsSync(p.file(CONFIG)), false);
  assert.equal(readMode(p.root), 'auto');
  assert.match(text(await h.read()), /new branch error contract/);
  assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('edit', { path: SOURCE })), undefined);
  saveMode(p.root, 'off');
  p.git('checkout', '--quiet', original);
  assert.equal(JSON.parse(p.read(CONFIG)).mode, 'auto');
  assert.equal(readMode(p.root), 'off', 'old tracked Auto must not undo an explicit local disable');
  assert.equal(await h.emit('before_agent_start'), undefined);
});

test('Git mode: enabled branches without specs permit code work and organic first-spec capture', async (t) => {
  const p = project(t, { git: true, mode: null, specs: false });
  assert.equal(readMode(p.root), 'off');
  assert.equal(fs.existsSync(modeConfigPath(p.root)), false);
  const h = api(p);
  h.select = (_title, options) => options[0];
  await h.menu();
  assert.equal(readMode(p.root), 'auto');
  assert.equal(fs.existsSync(p.file('specs')), false, 'enabling must not bootstrap documents');
  assert.equal(p.git('status', '--porcelain'), '');
  p.git('checkout', '--quiet', '-b', 'still-no-specs');
  assert.match((await h.emit('before_agent_start')).message.content, /mode=auto/);
  assert.doesNotMatch(text(await h.read()), /check failed/);
  assert.equal(await h.emit('tool_call', h.call('edit', { path: SOURCE })), undefined);
  await h.write(SOURCE, 'changed code');
  await h.assistant('No durable change. <!-- charterleaf: no-value -->');
  assert.match(review(await h.settle()), /empty-spec project/);
  assert.match(text(await h.write(SPEC, CONTRACT)), /0 structural errors/);
  assert.equal(p.read(SPEC), CONTRACT);
});

test('Git mode: linked worktrees share mode, independent repos do not, and config aliases stay user-owned', async (t) => {
  const p = project(t, { git: true, mode: null });
  const linked = p.file('linked');
  p.git('worktree', 'add', '--quiet', '--detach', linked);
  saveMode(p.root, 'auto');
  assert.equal(modeConfigPath(linked), modeConfigPath(p.root));
  assert.equal(readMode(linked), 'auto');
  saveMode(linked, 'off');
  assert.equal(readMode(p.root), 'off');
  const independent = project(t, { git: true, mode: null });
  assert.equal(readMode(independent.root), 'off');
  assert.equal(fs.existsSync(modeConfigPath(independent.root)), false);
  saveMode(p.root, 'auto');
  const h = api(p);
  h.ctx.cwd = linked;
  fs.symlinkSync(modeConfigPath(p.root), path.join(linked, 'mode-alias.json'));
  for (const input of [modeConfigPath(p.root), `@${modeConfigPath(p.root)}`, new URL(`file://${modeConfigPath(p.root)}`).href,
    path.relative(linked, modeConfigPath(p.root)), 'mode-alias.json', CONFIG]) {
    assert.equal(isModeConfig(linked, linked, input), true);
    for (const toolName of ['write', 'edit']) {
      const result = await h.emit('tool_call', h.call(toolName, { path: input, content: '{}' }));
      assert.match(result.reason, /Only the user/);
    }
  }
  assert.equal(readMode(p.root), 'auto');
});

test('project helpers: normalize separators and reject traversal, prefix siblings, invalid input and escaping symlinks', (t) => {
  const p = project(t);
  const outside = project(t, { mode: null, specs: false });
  for (const input of [null, undefined, 42, {}, '', 'bad\0name', '../escape', outside.file(SOURCE), `${p.root}-sibling/file`]) {
    assert.equal(projectPath(p.root, p.root, input), null, String(input));
  }
  assert.equal(projectPath(p.root, p.root, 'src\\service.js'), SOURCE);
  assert.equal(projectPath(p.root, p.file('src'), '../src/new.js'), 'src/new.js');
  assert.equal(projectPath(p.root, p.root, '.'), '.');
  fs.symlinkSync(outside.root, p.file('external'), 'dir');
  assert.equal(projectPath(p.root, p.root, 'external/new.js'), null);
  fs.symlinkSync(outside.file(SOURCE), p.file('external-file'));
  assert.equal(projectPath(p.root, p.root, 'external-file'), null);
  fs.symlinkSync(p.file(SOURCE), p.file('internal-file'));
  assert.equal(projectPath(p.root, p.root, 'internal-file'), SOURCE);
  assert.equal(fingerprint(p.root, 'external-file'), 'outside');
});

test('project helpers: Windows drive paths map to WSL and foreign UNC is rejected on Linux', {
  skip: process.platform === 'win32',
}, () => {
  assert.equal(projectPath('/mnt/c/project', '/mnt/c/project', 'C:\\project\\src\\new.js'), 'src/new.js');
  assert.equal(projectPath('/mnt/c/project', '/mnt/c/project', 'D:\\elsewhere\\file'), null);
  assert.equal(projectPath('/mnt/c/project', '/mnt/c/project', '\\\\server\\share\\file'), null);
  assert.equal(projectPath('/mnt/c/project', '/mnt/c/project', '//server/share/file'), null);
  const home = fs.realpathSync(os.homedir());
  assert.equal(projectPath(home, home, '~/charterleaf-test-new/file'), 'charterleaf-test-new/file');
});

test('project helpers: config through an outside symlink cannot be read or saved', (t) => {
  const p = project(t);
  const outside = project(t);
  fs.rmSync(p.file(CONFIG));
  fs.symlinkSync(outside.file(CONFIG), p.file(CONFIG));
  const before = outside.read(CONFIG);
  assert.throws(() => readMode(p.root), /escapes project/);
  assert.throws(() => saveMode(p.root, 'reference'), /escapes project/);
  assert.equal(outside.read(CONFIG), before);
});

test('project helpers: fingerprints cover contents, missing, directories and large files', (t) => {
  const p = project(t);
  const first = fingerprint(p.root, SOURCE);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint(p.root, SOURCE), first);
  p.write(SOURCE, 'different');
  assert.notEqual(fingerprint(p.root, SOURCE), first);
  assert.equal(fingerprint(p.root, 'absent'), 'missing');
  assert.equal(fingerprint(p.root, 'src'), 'not-file');
  p.write('large.bin', Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.match(fingerprint(p.root, 'large.bin'), /^large:2097153:/);
});

test('project helpers: real Git snapshots cover staged, deleted and untracked files; baseline excludes existing dirty', (t) => {
  const p = project(t, { git: true });
  assert.deepEqual([...gitSnapshot(p.root)], []);
  p.write(SOURCE, 'already dirty');
  p.write('existing.txt', 'already untracked');
  const before = gitSnapshot(p.root);
  assert.deepEqual([...before.keys()].sort(), ['existing.txt', SOURCE].sort());
  p.write(SOURCE, 'new dirty');
  p.git('add', SOURCE);
  fs.rmSync(p.file(SPEC));
  const untracked = process.platform === 'win32' ? 'new file.txt' : 'new\nfile.txt';
  p.write(untracked, 'new untracked');
  const after = gitSnapshot(p.root);
  assert.equal(after.get(SPEC), 'missing');
  assert.deepEqual(changedSince(before, after), [SPEC, SOURCE, untracked].sort());
  assert.deepEqual(changedSince(null, after), []);
  assert.deepEqual(changedSince(before, null), []);
  assert.equal(gitSnapshot(p.file('src')), null, 'nested path is not a repository root');
});

test('regression: a spec read must not credit a newer version that was never delivered', async (t) => {
  const p = project(t);
  const h = api(p);
  await h.read('specs/constitution.md');
  const call = h.call('read', { path: SPEC });
  await h.emit('tool_call', call);
  const delivered = p.read(SPEC);
  p.write(SPEC, CONTRACT.replace('public return shape', 'concurrently changed contract'));
  await h.result(call, { content: [{ type: 'text', text: delivered }] });
  await h.emit('context');
  const result = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(result?.block, true, 'the changed contract was not seen by the model');
  assert.match(result.reason, /concurrently changed contract/);
});

test('regression: a dangling file symlink to an outside target is unsafe even before target creation', (t) => {
  const p = project(t);
  const outside = project(t, { mode: null, specs: false });
  const target = outside.file('not-yet-created');
  fs.symlinkSync(target, p.file('dangling'));
  assert.equal(projectPath(p.root, p.root, 'dangling'), null);
});

for (const mode of [null, 'off']) {
  test(`existing specs with mode=${mode} remain silent and untouched until explicit adoption`, async (t) => {
    const p = project(t, { mode });
    const h = api(p);
    await h.emit('session_start');
    assert.equal(await h.emit('before_agent_start'), undefined);
    assert.equal(await h.read(), undefined);
    assert.equal(await h.emit('tool_call', h.call('edit', { path: SPEC })), undefined);
    assert.equal(await h.settle(), undefined);
    assert.deepEqual(h.notifications, []);
    assert.equal(p.read(SPEC), CONTRACT);
    if (mode === null) assert.equal(fs.existsSync(p.file(CONFIG)), false);
  });
}

test('first enable in an empty project writes only mode config, not invented spec documents', async (t) => {
  const p = project(t, { mode: null, specs: false });
  const h = api(p);
  h.select = (_title, options) => options[0];
  await h.menu();
  assert.equal(readMode(p.root), 'auto');
  assert.deepEqual(fs.readdirSync(p.file('specs')), ['.charterleaf.json']);
});

test('successful spec write runs real lint even when structural errors remain', async (t) => {
  const p = project(t);
  const h = api(p);
  const result = await h.write('specs/capabilities/broken.md', '# Missing frontmatter\n');
  assert.match(text(result), /structural check \(not semantic verification\)/);
  assert.match(text(result), /ERROR.*broken.md/);
  assert.match(text(result), /[1-9]\d* structural errors/);
  assert.equal(p.read('specs/capabilities/broken.md'), '# Missing frontmatter\n');
});

test('adding a living spec invalidates cached misses for new scopes', async (t) => {
  const p = project(t);
  p.write('docs/guide.txt', 'guide');
  const h = api(p);
  assert.match(text(await h.read('docs/guide.txt')), /No applies_to glob matched/);
  await h.emit('context');
  await h.write('specs/engineering/docs.md',
    '---\nid: docs.contract\napplies_to:\n  - docs/**\n---\n# Docs\nKeep links relative.\n');
  const blocked = await h.emit('tool_call', h.call('edit', { path: 'docs/guide.txt' }));
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /Keep links relative/);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('edit', { path: 'docs/guide.txt' })), undefined);
});

test('context budget is bounded across specs and requires an explicit read for the remainder', async (t) => {
  const p = project(t);
  p.write(SPEC, CONTRACT.padEnd(7900, 'x'));
  p.write('specs/engineering/second.md',
    '---\nid: second.contract\napplies_to:\n  - src/**\n---\n# Second\n'.padEnd(7900, 'y'));
  p.write('specs/engineering/third.md',
    '---\nid: third.contract\napplies_to:\n  - src/**\n---\n# Third\n'.padEnd(7900, 'z'));
  p.write('specs/engineering/fourth.md',
    '---\nid: fourth.contract\napplies_to:\n  - src/**\n---\n# Fourth\n'.padEnd(7900, 'q'));
  const h = api(p);
  const first = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(first.block, true);
  assert.match(first.reason, /automatic context budget reached/);
  const sibling = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(sibling.block, true, 'siblings still cannot modify before context delivery');
  await h.emit('context');
  const stillBlocked = await h.emit('tool_call', h.call('write', { path: SOURCE }));
  assert.equal(stillBlocked.block, true, 'oversized aggregate leaves an unread spec');
  assert.match(stillBlocked.reason, /Read the complete specs\/engineering\/third.md/);
  assert.doesNotMatch(stillBlocked.reason, /Read the complete specs\/capabilities\/service.md/);
  assert.doesNotMatch(stillBlocked.reason, /Read the complete specs\/engineering\/(second|fourth).md/);
  await h.read('specs/engineering/third.md');
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('routing miss caps metadata list without leaking any unmatched spec bodies', async (t) => {
  const p = project(t);
  for (let i = 0; i < 13; i++) {
    p.write(`specs/capabilities/area-${String(i).padStart(2, '0')}.md`,
      `---\nid: area.${i}\napplies_to:\n  - area-${i}/**\n---\n# Body\nPRIVATE-UNMATCHED-BODY-${i}\n`);
  }
  p.write('docs/file.txt', 'docs');
  const h = api(p);
  const content = text(await h.read('docs/file.txt'));
  assert.match(content, /More specs exist; use charterleaf related <path>/);
  assert.equal(content.split('\n').filter((line) => /: specs\/capabilities\//.test(line)).length, 12);
  assert.doesNotMatch(content, /PRIVATE-UNMATCHED-BODY/);
});

test('spec aliases inside the project enforce spec mode, while outside paths are out of project scope', async (t) => {
  const p = project(t, { mode: 'reference' });
  const outside = project(t, { mode: null });
  fs.symlinkSync(p.file(SPEC), p.file('spec-alias'));
  const h = api(p);
  const blocked = await h.emit('tool_call', h.call('write', { path: 'spec-alias' }));
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /Reference mode/);
  const outsideCall = h.call('write', { path: outside.file(SOURCE) });
  assert.equal(await h.emit('tool_call', outsideCall), undefined);
  outside.write(SOURCE, 'outside project edit');
  assert.equal(await h.result(outsideCall), undefined);
  assert.equal(await h.settle(), undefined, 'no attribution for a different project');
});

test('Git helpers: uncommitted repository and newly staged files can form a baseline', (t) => {
  const p = project(t);
  p.git('init', '--quiet');
  p.git('add', SOURCE);
  const before = gitSnapshot(p.root);
  assert.ok(before instanceof Map);
  assert.ok(before.has(SOURCE));
  p.write(SOURCE, 'modified after staging');
  p.write('new.txt', 'new');
  assert.deepEqual(changedSince(before, gitSnapshot(p.root)), [SOURCE, 'new.txt'].sort());
});

test('regression: Git attribution must observe index-only changes with unchanged worktree contents', (t) => {
  const p = project(t, { git: true });
  const original = p.read(SOURCE);
  p.write(SOURCE, 'first staged version');
  p.git('add', SOURCE);
  p.write(SOURCE, original);
  const before = gitSnapshot(p.root);
  p.write(SOURCE, 'parallel staged version');
  p.git('add', SOURCE);
  p.write(SOURCE, original);
  const after = gitSnapshot(p.root);
  assert.equal(p.git('show', `:${SOURCE}`), 'parallel staged version');
  assert.deepEqual(changedSince(before, after), [SOURCE]);
});

test('repeated sibling routing does not debit the staged spec budget repeatedly', async (t) => {
  const p = project(t);
  p.write(SPEC, CONTRACT.padEnd(7900, 'x'));
  for (const name of ['second', 'third']) {
    p.write(`specs/engineering/${name}.md`,
      `---\nid: ${name}.contract\napplies_to:\n  - src/next/**\n---\n# ${name}\n`.padEnd(7900, 'y'));
  }
  const h = api(p);
  for (let i = 0; i < 3; i++) {
    const block = await h.emit('tool_call', h.call('write', { path: SOURCE }));
    assert.equal(block.block, true);
    if (i === 0) assert.match(block.reason, /SERVICE-001/);
    else assert.match(block.reason, /already supplied/);
  }
  await h.emit('context');
  const next = await h.emit('tool_call', h.call('write', { path: 'src/next/file.js' }));
  assert.equal(next.block, true);
  assert.doesNotMatch(next.reason, /automatic context budget reached/);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: 'src/next/file.js' })), undefined);
});


test('nested standard tools deliver constraints through the outer result even if the script discards them', async (t) => {
  const p = project(t);
  const h = api(p);
  const outer = h.call('codemode', {});
  await h.emit('tool_call', outer);
  const nested = { ...h.call('read', { path: SOURCE }), parentToolCallId: outer.toolCallId };
  await h.emit('tool_call', nested);
  const result = await h.result(nested);
  assert.match(text(result), /SERVICE-001/);
  const parent = await h.result(outer, { content: [{ type: 'text', text: 'script discarded nested output' }] });
  assert.match(text(parent), /SERVICE-001/);
  assert.match(text(parent), /Never expose credentials/);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('nested blocked mutation forwards constraints through a failed outer tool', async (t) => {
  const p = project(t);
  const h = api(p);
  const outer = h.call('codemode', {});
  await h.emit('tool_call', outer);
  const nested = { ...h.call('write', { path: SOURCE }), parentToolCallId: outer.toolCallId };
  const block = await h.emit('tool_call', nested);
  assert.equal(block.block, true);
  const parent = await h.result(outer, { isError: true });
  assert.match(text(parent), /SERVICE-001/);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('Reference refuses project spec paths that point outside through a symlink', async (t) => {
  const p = project(t, { mode: 'reference' });
  const outside = project(t, { mode: null });
  fs.symlinkSync(outside.file(SPEC), p.file('specs/escape.md'));
  const h = api(p);
  const block = await h.emit('tool_call', h.call('write', { path: 'specs/escape.md', content: 'no' }));
  assert.equal(block.block, true);
  assert.match(block.reason, /Unsafe spec path/);
  assert.equal(outside.read(SPEC), CONTRACT);
});

test('custom read-only tools and concurrent work do not trigger maintenance in a read-only task', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.emit('before_agent_start');
  p.write(SOURCE, 'parallel work');
  await h.read();
  assert.equal(await h.settle(), undefined);
});


test('compact runtime rules are supplied once per branch; the full authoring guide stays on demand', async (t) => {
  const p = project(t);
  const h = api(p);
  const first = await h.emit('before_agent_start');
  assert.match(first.message.content, /## One final semantic review/);
  assert.doesNotMatch(first.message.content, /## Optional staged changes/);
  assert.match(first.message.content, /Guide .*SKILL\.md/);
  assert.match(first.message.content, /Modes govern specs, not code/);
  assert.match(first.message.content, /Internal\/refactor requests do not authorize changing return or ownership contracts/);
  // Installation paths vary; only fixed guidance belongs to the context budget.
  const packageRoot = path.dirname(path.dirname(require.resolve('../extensions/charterleaf.js')));
  const normalized = first.message.content.replaceAll(p.root, '<root>').replaceAll(packageRoot, '<package>');
  assert.ok(Buffer.byteLength(normalized) < 2400, 'compact rules must retain the contract and approval distinctions');
  const second = await h.emit('before_agent_start');
  assert.doesNotMatch(second.message.content, /## One final semantic review/);
  assert.match(second.message.content, /mode=auto/);
  assert.ok(Buffer.byteLength(second.message.content) < 150);
  await h.emit('session_tree');
  const restored = await h.emit('before_agent_start');
  assert.match(restored.message.content, /## One final semantic review/);
});

test('unsupported read-only annotated tools do not trigger a Git-less final review', async (t) => {
  const p = project(t);
  let resultHandler;
  let settleHandler;
  charterleaf({
    registerCommand() {},
    on(name, handler) {
      if (name === 'tool_result') resultHandler = handler;
      if (name === 'agent_before_settle') settleHandler = handler;
    },
    getAllTools: () => [{ name: 'search', annotations: { readOnlyHint: true } }],
  });
  const ctx = { cwd: p.root, hasUI: false };
  await resultHandler({ toolName: 'search', toolCallId: 'search', content: [], isError: false }, ctx);
  assert.equal(await settleHandler({ outcome: 'completed', entries: [], context: { canContinue: true } }, ctx), undefined);
});


test('large standard spec reads can complete across verified offset pages without a write deadlock', async (t) => {
  const p = project(t);
  p.write(SPEC, CONTRACT + Array.from({ length: 2100 }, (_, i) => `Constraint line ${i}`).join('\n'));
  const lines = p.read(SPEC).split('\n');
  const h = api(p);
  const first = h.call('read', { path: SPEC });
  await h.emit('tool_call', first);
  await h.result(first, { content: [{ type: 'text', text: lines.slice(0, 2000).join('\n') +
    `\n\n[Showing lines 1-2000 of ${lines.length}. Use offset=2001 to continue.]` }] });
  await h.emit('context');
  assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
  const last = h.call('read', { path: SPEC, offset: 2001 });
  await h.emit('tool_call', last);
  await h.result(last, { content: [{ type: 'text', text: lines.slice(2000).join('\n') }] });
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('paged spec reads do not credit missing or concurrently changed pages', async (t) => {
  const p = project(t);
  p.write(SPEC, CONTRACT + Array.from({ length: 2100 }, (_, i) => `Constraint line ${i}`).join('\n'));
  let lines = p.read(SPEC).split('\n');
  const h = api(p);
  const first = h.call('read', { path: SPEC, limit: 1000 });
  await h.emit('tool_call', first);
  await h.result(first, { content: [{ type: 'text', text: lines.slice(0, 1000).join('\n') +
    `\n\n[${lines.length - 1000} more lines in file. Use offset=1001 to continue.]` }] });
  const skipped = h.call('read', { path: SPEC, offset: 2001 });
  await h.emit('tool_call', skipped);
  await h.result(skipped, { content: [{ type: 'text', text: lines.slice(2000).join('\n') }] });
  await h.emit('context');
  assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
  p.write(SPEC, p.read(SPEC).replace('Constraint line 1\n', 'Changed contract line 1\n'));
  lines = p.read(SPEC).split('\n');
  const rest = h.call('read', { path: SPEC, offset: 1001 });
  await h.emit('tool_call', rest);
  await h.result(rest, { content: [{ type: 'text', text: lines.slice(1000).join('\n') }] });
  await h.emit('context');
  assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
});


for (const mode of ['reference', 'confirm']) {
  test(`${mode}: Pi @ and file URL path aliases cannot bypass spec or config authorization`, async (t) => {
    const p = project(t, { mode });
    const h = api(p);
    await h.prime();
    const aliases = [`@${SPEC}`, new URL(`file://${p.file(SPEC)}`).href];
    for (const alias of aliases) {
      const call = h.call('write', { path: alias, content: 'not approved' });
      const result = await h.emit('tool_call', call);
      assert.equal(result.block, true);
      assert.equal(call.input.path, p.file(SPEC), 'checked and executed paths must agree');
    }
    assert.equal(h.approvals.length, mode === 'confirm' ? 1 : 0, 'normalized aliases share the same refused proposal');
    for (const alias of [`@${CONFIG}`, new URL(`file://${p.file(CONFIG)}`).href]) {
      const result = await h.emit('tool_call', h.call('write', { path: alias, content: '{}' }));
      assert.equal(result.block, true);
      assert.match(result.reason, /Only the user/);
    }
    assert.equal(p.read(SPEC), CONTRACT);
  });
}

test('oversized single-line native read notice never counts as delivered spec content', async (t) => {
  const p = project(t);
  fs.rmSync(p.file(SPEC));
  p.write('specs/constitution.md', 'x'.repeat(60 * 1024));
  const h = api(p);
  const call = h.call('read', { path: 'specs/constitution.md' });
  await h.emit('tool_call', call);
  await h.result(call, { details: { truncation: { truncated: true, firstLineExceedsLimit: true } },
    content: [{ type: 'text', text: '[Line 1 is 60.0KB, exceeds 50.0KB limit. Use bash: ...]' }] });
  await h.emit('context');
  assert.equal((await h.emit('tool_call', h.call('write', { path: SOURCE }))).block, true);
});

test('ordinary spec prose about truncation does not reject a genuine complete read', async (t) => {
  const p = project(t);
  p.write(SPEC, CONTRACT + '\nNever truncate the public result or use offset as an API default.\n' + 'x'.repeat(8100));
  const h = api(p);
  await h.read('specs/constitution.md');
  await h.read(SPEC);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
});

test('in-project path normalization matches Pi aliases and leaves unrelated tools unchanged', async (t) => {
  const p = project(t);
  p.write('src/space name.js', 'space');
  assert.equal(projectPath(p.root, p.root, '@src/space\u00a0name.js'), 'src/space name.js');
  assert.equal(projectPath(p.root, p.root, '@@specs/example.md'), '@specs/example.md', 'strip only one @');
  const h = api(p);
  const call = h.call('read', { path: '@src\\space\u00a0name.js' });
  await h.emit('tool_call', call);
  assert.equal(call.input.path, p.file('src/space name.js'));
  const unrelated = h.call('custom_tool', { path: '@src\\space\u00a0name.js' });
  await h.emit('tool_call', unrelated);
  assert.equal(unrelated.input.path, '@src\\space\u00a0name.js');
});


for (const options of [{ offset: 1, limit: 2000 }, { limit: 500 }, { startLine: 1, endLine: 500 }]) {
  test(`regression: verified complete budget-exceeding read ${JSON.stringify(options)} releases the gate`, async (t) => {
    const p = project(t);
    p.write(SPEC, CONTRACT + Array.from({ length: 180 }, (_, i) => `Durable constraint ${i}: preserve immutable caller inputs.\n`).join(''));
    const h = api(p);
    await h.read('specs/constitution.md');
    await h.read(SPEC, options);
    assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
    await h.emit('context');
    assert.equal(await h.emit('tool_call', h.call('edit', { path: SOURCE })), undefined);
  });
}

for (const options of [{ offset: 1, limit: 2000 }, { startLine: 1, endLine: 500 }, {}]) {
  test(`AFT: complete numbered spec read ${JSON.stringify(options)} releases only after context`, async (t) => {
    for (const ending of ['\n', '', '\r\n']) {
      const p = project(t);
      const body = (CONTRACT + '\n 1: literal source prefix\n' + Array.from({ length: 180 }, (_, i) => `Constraint ${i}: preserve caller inputs and public return shapes.`).join('\n')).replace(/\n/g, ending === '\r\n' ? '\r\n' : '\n') + ending;
      p.write(SPEC, body);
      assert.ok(Buffer.byteLength(body) > 8000);
      const h = api(p);
      await h.read('specs/constitution.md');
      const call = h.call('read', { path: SPEC, ...options });
      await h.emit('tool_call', call);
      await h.result(call, { content: [{ type: 'text', text: numberedPage(body) }] });
      assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
      await h.emit('context');
      assert.equal(await h.emit('tool_call', h.call('edit', { path: SOURCE })), undefined);
    }
  });
}

test('AFT: verified numbered pages support overlap and out-of-order completion', async (t) => {
  const p = project(t);
  const body = CONTRACT + Array.from({ length: 180 }, (_, i) => `Constraint ${i}: preserve caller inputs and public return shapes.\n`).join('');
  p.write(SPEC, body);
  const h = api(p);
  await h.read('specs/constitution.md');
  for (const [offset, limit] of [[101, 200], [1, 60], [50, 60]]) {
    const call = h.call('read', { path: SPEC, offset, limit });
    await h.emit('tool_call', call);
    await h.result(call, { content: [{ type: 'text', text: numberedPage(body, offset, limit) + (offset === 1 ? '\n(File is large; use startLine/endLine or offset/limit to read a section.)' : '') }] });
    assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
    await h.emit('context');
    const gate = await h.emit('tool_call', h.call('edit', { path: SOURCE }));
    if (offset === 50) assert.equal(gate, undefined);
    else assert.equal(gate.block, true);
  }
});

for (const scenario of ['gap', 'changed-between-pages', 'changed-during-read', 'wrong-number', 'duplicate-number', 'wrong-body', 'truncated-line', 'partial-default-read']) {
  test(`AFT: ${scenario} cannot credit unread constraints`, async (t) => {
    const p = project(t);
    let body = CONTRACT + Array.from({ length: 180 }, (_, i) => `Constraint ${i}: preserve caller inputs and public return shapes.\n`).join('');
    p.write(SPEC, body);
    const h = api(p);
    await h.read('specs/constitution.md');
    const first = h.call('read', { path: SPEC, offset: 1, limit: 60 });
    await h.emit('tool_call', first);
    await h.result(first, { content: [{ type: 'text', text: numberedPage(body, 1, 60) }] });
    if (scenario === 'changed-between-pages') {
      body = body.replace('Constraint 0:', 'Changed rule 0:');
      p.write(SPEC, body);
    }
    const offset = scenario === 'gap' ? 101 : scenario === 'changed-between-pages' ? 61 : 1;
    const call = h.call('read', { path: SPEC, ...(scenario === 'partial-default-read' ? {} : { offset, limit: 2000 }) });
    await h.emit('tool_call', call);
    let page = numberedPage(body, offset);
    if (scenario === 'changed-during-read') p.write(SPEC, body + 'New contract.\n');
    if (scenario === 'wrong-number') page = page.replace(/1: /, '2: ');
    if (scenario === 'wrong-body') page = page.replace('preserve caller inputs', 'discard caller inputs');
    if (scenario === 'truncated-line') page = page.replace('preserve caller inputs', 'preserve [line truncated]');
    if (scenario === 'partial-default-read') page = numberedPage(body, 1, 60);
    if (scenario === 'duplicate-number') page = page.replace(/2: /, '1: ');
    await h.result(call, { content: [{ type: 'text', text: page }] });
    await h.emit('context');
    assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
  });
}

for (const mode of ['reference', 'confirm']) {
  test(`regression: ${mode} protects lexical spec identity when symlinks point into another project directory`, async (t) => {
    const p = project(t, { mode });
    p.write('docs/contract.md', CONTRACT);
    fs.symlinkSync(p.file('docs/contract.md'), p.file('specs/alias.md'));
    const h = api(p);
    await h.prime();
    const result = await h.emit('tool_call', h.call('write', { path: 'specs/alias.md', content: 'unauthorized' }));
    assert.equal(result.block, true);
    assert.equal(h.approvals.length, mode === 'confirm' ? 1 : 0);
    assert.equal(p.read('docs/contract.md'), CONTRACT);
  });
}

test('regression: config symlink and its backing path cannot authorize agent mode changes', async (t) => {
  const p = project(t);
  p.write('settings/mode.json', p.read(CONFIG));
  fs.unlinkSync(p.file(CONFIG));
  fs.symlinkSync(p.file('settings/mode.json'), p.file(CONFIG));
  const h = api(p);
  await h.prime();
  for (const file of [CONFIG, 'settings/mode.json']) {
    const result = await h.emit('tool_call', h.call('write', { path: file, content: '{"version":1,"mode":"off"}' }));
    assert.equal(result.block, true);
    assert.match(result.reason, /Only the user/);
  }
  assert.equal(readMode(p.root), 'auto');
});

test('regression: Git staged and unstaged renames include both affected areas', (t) => {
  const p = project(t, { git: true });
  for (const staged of [false, true]) {
    const before = gitSnapshot(p.root);
    fs.mkdirSync(p.file('other'), { recursive: true });
    fs.renameSync(p.file(SOURCE), p.file('other/service.js'));
    if (staged) p.git('add', '-A');
    assert.deepEqual(changedSince(before, gitSnapshot(p.root)), ['other/service.js', SOURCE].sort());
    fs.renameSync(p.file('other/service.js'), p.file(SOURCE));
    p.git('reset', '--quiet');
  }
});

test('regression: Git detects dirty symlink retargets even with equal content or dangling targets', (t) => {
  const p = project(t, { git: true });
  p.write('a.txt', 'same');
  p.write('b.txt', 'same');
  fs.symlinkSync('a.txt', p.file('alias'));
  let before = gitSnapshot(p.root);
  fs.unlinkSync(p.file('alias'));
  fs.symlinkSync('b.txt', p.file('alias'));
  assert.ok(changedSince(before, gitSnapshot(p.root)).includes('alias'));
  before = gitSnapshot(p.root);
  fs.unlinkSync(p.file('alias'));
  fs.symlinkSync('missing-a', p.file('alias'));
  assert.ok(changedSince(before, gitSnapshot(p.root)).includes('alias'));
  before = gitSnapshot(p.root);
  fs.unlinkSync(p.file('alias'));
  fs.symlinkSync('missing-b', p.file('alias'));
  assert.ok(changedSince(before, gitSnapshot(p.root)).includes('alias'));
});

test('regression: missing initial Git baseline still reviews opaque evidence when final snapshot recovers', async (t) => {
  const p = project(t, { git: true });
  for (let i = 0; i < 501; i++) p.write(`overflow/${i}`, 'temporary fixture');
  const h = api(p);
  await h.emit('before_agent_start');
  fs.rmSync(p.file('overflow'), { recursive: true });
  assert.ok(gitSnapshot(p.root));
  await h.result(h.call('bash', { command: 'opaque operation' }));
  const content = review(await h.settle({ context: { canContinue: false } }));
  assert.match(content, /Git change inspection unavailable \(baseline or final snapshot missing\)/);
  assert.deepEqual(pathsInReview(content, OWNED), []);
  assert.equal(await h.settle(), undefined);
});


for (const json of [false, true]) {
  test(`regression: nested constraint forwarding does not duplicate already visible ${json ? 'JSON' : 'text'} bodies`, async (t) => {
    const p = project(t);
    const h = api(p);
    const outer = h.call('codemode', {});
    await h.emit('tool_call', outer);
    const nested = { ...h.call('read', { path: SOURCE }), parentToolCallId: outer.toolCallId };
    await h.emit('tool_call', nested);
    const result = await h.result(nested);
    const visible = json ? JSON.stringify(result) : text(result);
    const parent = await h.result(outer, { content: [{ type: 'text', text: visible }] });
    assert.equal(parent, undefined, 'unchanged parent content already contains every forwarded constraint');
    assert.equal((visible.match(/SERVICE-001/g) || []).length, 1);
    await h.emit('context');
    assert.equal(await h.emit('tool_call', h.call('write', { path: SOURCE })), undefined);
  });
}


test('regression: authorized internal spec aliases still receive spec lint and are not credited as code edits', async (t) => {
  const p = project(t);
  p.write('docs/contract.md', CONTRACT);
  fs.symlinkSync(p.file('docs/contract.md'), p.file('specs/alias.md'));
  const h = api(p);
  const call = h.call('write', { path: 'specs/alias.md', content: CONTRACT + '\nDurable knowledge.\n' });
  assert.equal(await h.emit('tool_call', call), undefined);
  fs.writeFileSync(call.input.path, call.input.content);
  assert.match(text(await h.result(call)), /Charterleaf structural check/);
  assert.equal(await h.settle(), undefined);
});


test('new tasks reuse only delivered same-branch spec hashes, with fresh ownership, baseline and budget', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.prime();
  await h.write(SOURCE, 'first task');
  await h.emit('before_agent_start');
  assert.equal(text(await h.read()), '', 'same version is already in retained context');
  assert.equal(await h.emit('tool_call', h.call('edit', { path: SOURCE })), undefined);
  assert.equal(await h.settle(), undefined, 'old task edits must not trigger a new review');
  p.write(SPEC, CONTRACT.replace('public return shape', 'updated public return shape'));
  const block = await h.emit('tool_call', h.call('edit', { path: SOURCE }));
  assert.equal(block.block, true);
  assert.match(block.reason, /updated public return shape/);
  await h.emit('context');
  await h.emit('session_compact');
  await h.emit('before_agent_start');
  assert.equal((await h.emit('tool_call', h.call('edit', { path: SOURCE }))).block, true);
});

test('new tasks do not credit staged sibling constraints until their model request', async (t) => {
  const p = project(t);
  const h = api(p);
  await h.emit('before_agent_start');
  await h.read();
  await h.emit('before_agent_start');
  const block = await h.emit('tool_call', h.call('edit', { path: SOURCE }));
  assert.equal(block.block, true);
  assert.match(block.reason, /SERVICE-001/);
  await h.emit('context');
  assert.equal(await h.emit('tool_call', h.call('edit', { path: SOURCE })), undefined);
});


test('Confirm never repeats an approval dialog for the same refused proposal within a task', async (t) => {
  const p = project(t, { mode: 'confirm' });
  const h = api(p);
  await h.emit('before_agent_start');
  for (let i = 0; i < 2; i++) assert.equal((await h.write(SPEC, 'same proposed update')).block, true);
  assert.equal(h.approvals.length, 1);
  assert.equal(p.read(SPEC), CONTRACT);
  await h.emit('before_agent_start');
  assert.equal((await h.write(SPEC, 'same proposed update')).block, true);
  assert.equal(h.approvals.length, 2, 'a new user task can make a fresh proposal');
});


for (const git of [false, true]) {
  test(`organic discovery: pending semantic candidate can review without code/specs (Git=${git})`, async (t) => {
    const p = project(t, { git, specs: false });
    const h = api(p);
    await h.emit('before_agent_start');
    await h.read();
    await h.assistant('Verified an undocumented invariant against accepted policy and tests.\n<!-- charterleaf: review -->');
    const content = review(await h.settle());
    assert.match(content, /unresolved durable knowledge/);
    assert.match(content, /Judge the conversation evidence, not the signal/);
    assert.deepEqual(pathsInReview(content, OWNED), []);
    assert.deepEqual(pathsInReview(content, UNATTRIBUTED), []);
    assert.equal(await h.settle(), undefined);
    assert.deepEqual(fs.readdirSync(p.file('specs')), ['.charterleaf.json']);
  });
}

test('ordinary file viewing/search/chat and quoted signals never imply discovered knowledge', async (t) => {
  const p = project(t, { specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  for (let i = 0; i < 8; i++) await h.read();
  await h.result(h.call('grep', { pattern: 'module' }));
  await h.emit('message_end', { message: { role: 'user', content: [{ type: 'text', text: '<!-- charterleaf: review -->' }] } });
  await h.emit('message_end', { message: { role: 'toolResult', content: [{ type: 'text', text: '<!-- charterleaf: review -->' }] } });
  await h.assistant('The example is:\n```html\n<!-- charterleaf: review -->\n```');
  await h.assistant('Inline <!-- charterleaf: review -->');
  await h.assistant('<!-- charterleaf: review -->', { stopReason: 'error' });
  await h.assistant('<!-- charterleaf: review -->', { stopReason: 'aborted' });
  assert.equal(await h.settle(), undefined);
});

test('knowledge judged without writing suppresses a redundant development review', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.prime();
  await h.write(SOURCE, 'changed');
  await h.assistant('Existing authority already documents it; no routing gap.\n<!-- charterleaf: covered -->');
  assert.equal(await h.settle(), undefined);
  assert.equal(p.read(SPEC), CONTRACT);
});

test('successful organic capture suppresses same-task review and routes in a fresh session', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.write(SOURCE, 'changed implementation');
  await h.assistant('Concrete discovery needs judgment.\n<!-- charterleaf: review -->');
  assert.match(text(await h.write(SPEC, CONTRACT)), /0 structural errors/);
  await h.result(h.call('bash', { command: 'run tests' }));
  await h.read();
  assert.equal(await h.settle(), undefined, 'already captured, including later reads/tests with no diff');
  const next = api(p);
  await next.emit('before_agent_start');
  const block = await next.emit('tool_call', next.call('edit', { path: SOURCE }));
  assert.equal(block.block, true);
  assert.match(block.reason, /SERVICE-001/);
  await next.emit('context');
  assert.equal(await next.emit('tool_call', next.call('edit', { path: SOURCE })), undefined);
});

test('invalid or failed spec writes cannot satisfy pending knowledge review', async (t) => {
  const p = project(t, { specs: false });
  const h = api(p);
  await h.assistant('An evidenced candidate.\n<!-- charterleaf: review -->');
  const call = h.call('write', { path: SPEC, content: CONTRACT });
  await h.emit('tool_call', call);
  await h.result(call, { isError: true });
  assert.match(text(await h.write(SPEC, '# Missing routing metadata\n')), /structural errors/);
  review(await h.settle());
});

for (const activity of ['code', 'opaque', 'candidate']) {
  test(`distinct ${activity} after capture can rearm, but never loop`, async (t) => {
    const p = project(t, { git: true, specs: false });
    const h = api(p);
    await h.write(SPEC, CONTRACT);
    if (activity === 'code') {
      await h.prime();
      await h.write(SOURCE, 'later change');
    } else if (activity === 'opaque') {
      p.write('src/later.js', 'opaque write');
      await h.result(h.call('bash', { command: 'external_writer' }));
    } else await h.assistant('Distinct evidenced discovery.\n<!-- charterleaf: review -->');
    review(await h.settle());
    await h.assistant('Another candidate.\n<!-- charterleaf: review -->');
    assert.equal(await h.settle(), undefined);
  });
}

test('semantic candidate state is task-local; last explicit judgment wins', async (t) => {
  const p = project(t, { specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.assistant('<!-- charterleaf: review -->');
  await h.assistant('<!-- charterleaf: covered -->');
  assert.equal(await h.settle(), undefined);
  await h.emit('before_agent_start');
  await h.assistant('<!-- charterleaf: review -->');
  await h.emit('before_agent_start');
  assert.equal(await h.settle(), undefined);
  await h.emit('before_agent_start');
  await h.assistant('<!-- charterleaf: covered -->');
  await h.assistant('<!-- charterleaf: review -->');
  review(await h.settle());
});

for (const mode of ['auto', 'confirm', 'reference']) {
  test(`empty specs ${mode}: organic capture preserves exact existing permissions`, async (t) => {
    const p = project(t, { mode, specs: false });
    const h = api(p);
    await h.emit('before_agent_start');
    await h.assistant('<!-- charterleaf: review -->');
    const result = await h.write(SPEC, CONTRACT);
    if (mode === 'auto') {
      assert.match(text(result), /0 structural errors/);
      assert.equal(await h.settle(), undefined);
    } else {
      assert.equal(result.block, true);
      assert.equal(fs.existsSync(p.file(SPEC)), false);
      await h.assistant('Proposal reported; no retry.\n<!-- charterleaf: proposed -->');
      assert.equal(await h.settle(), undefined);
    }
    assert.equal(h.approvals.length, mode === 'confirm' ? 1 : 0);
    if (mode === 'confirm') {
      await h.emit('before_agent_start');
      h.confirm = () => true;
      assert.match(text(await h.write(SPEC, CONTRACT)), /0 structural errors/);
      assert.equal(h.approvals.length, 2);
    }
  });
}

test('new runtime retains evidence, duplication, authority and explicit read-only discipline', async (t) => {
  const h = api(project(t, { specs: false }));
  const rules = (await h.emit('before_agent_start')).message.content;
  for (const pattern of [/newly established OR newly discovered/, /even without code changes\/prior specs/,
    /reliable evidence/, /mistake-prevention/, /documentation\/discoverability gap/, /Code alone is not an accepted contract/,
    /prefer short routed references/, /read-only\/no-file-write requests override Auto/, /never relax specs to match code/,
    /not by read counts/, /at most one extra review/i, /All modes allow normal code edits/,
    /Reference proposes, never writes specs/, /NOT merely finishing code\/tests/, /tests aren't automatic code-path routing/, /Reasons outside, never inside comments/,
    /Confirm calls spec write\/edit to open Extension approval/]) assert.match(rules, pattern);
});


test('an accepted engineering decision can request judgment without reads, edits or Git', async (t) => {
  const p = project(t, { specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.assistant('The user accepted a durable boundary; documentation is still unresolved.\n<!-- charterleaf: review -->');
  const content = review(await h.settle());
  assert.match(content, /accepted decisions/);
  assert.deepEqual(pathsInReview(content, OWNED), []);
  assert.equal(await h.settle(), undefined);
});

test('no-UI Confirm cannot bootstrap a spec from a semantic discovery signal', async (t) => {
  const p = project(t, { mode: 'confirm', specs: false });
  const h = api(p, { hasUI: false });
  await h.assistant('<!-- charterleaf: review -->');
  const block = await h.write(SPEC, CONTRACT);
  assert.equal(block.block, true);
  assert.match(block.reason, /requires interactive approval/);
  assert.equal(fs.existsSync(p.file(SPEC)), false);
  assert.deepEqual(h.approvals, []);
  await h.assistant('Proposal reported without writing.\n<!-- charterleaf: proposed -->');
  assert.equal(await h.settle(), undefined);
});


test('generic task done cannot suppress the development knowledge fallback', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.write(SOURCE, 'real development');
  await h.assistant('Implementation and tests finished.\n<!-- charterleaf: done -->');
  review(await h.settle());
  assert.equal(await h.settle(), undefined);
});

for (const conclusion of ['covered', 'no-value', 'proposed']) {
  test(`explicit ${conclusion} knowledge judgment avoids duplicate review, without granting write authority`, async (t) => {
    const p = project(t, { mode: 'reference', git: true, specs: false });
    const h = api(p);
    await h.assistant(`Knowledge assessment complete.\n<!-- charterleaf: ${conclusion} -->`);
    assert.equal((await h.write(SPEC, CONTRACT)).block, true);
    assert.equal(fs.existsSync(p.file(SPEC)), false);
    assert.equal(await h.settle(), undefined);
  });
}


test('Confirm prose alone is not a gate-handled proposal completion signal', async (t) => {
  const p = project(t, { mode: 'confirm', git: true, specs: false });
  const h = api(p);
  await h.write(SOURCE, 'normal implementation change');
  await h.assistant('Please approve later.\n<!-- charterleaf: proposed -->');
  review(await h.settle());
  assert.deepEqual(h.approvals, []);
  assert.equal(fs.existsSync(p.file(SPEC)), false);
});


test('empty-spec development gets one fallback even after a no-value conclusion', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.write(SOURCE, 'owned code change');
  await h.assistant('<!-- charterleaf: no-value -->');
  const content = review(await h.settle());
  assert.match(content, /verify the no-value conclusion/);
  assert.doesNotMatch(content, /agent identified unresolved durable knowledge/);
  assert.deepEqual(pathsInReview(content, OWNED), [SOURCE]);
  assert.equal(await h.settle(), undefined);
});

for (const specs of [true, false]) {
  test(`no-value read-only judgment cannot review parallel work (existing specs=${specs})`, async (t) => {
    const p = project(t, { git: true, specs });
    const h = api(p);
    await h.emit('before_agent_start');
    await h.read();
    p.write(SOURCE, 'parallel work');
    await h.assistant('<!-- charterleaf: no-value -->');
    assert.equal(await h.settle(), undefined);
  });
}

test('effective existing specs allow a no-value development judgment without redundant review', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.prime();
  await h.write(SOURCE, 'owned code change');
  await h.assistant('<!-- charterleaf: no-value -->');
  assert.equal(await h.settle(), undefined);
});


for (const conclusion of ['covered', 'no-value', 'proposed']) {
  test(`later real code edits rearm a prior ${conclusion} judgment`, async (t) => {
    const p = project(t, { git: true, specs: false });
    const h = api(p);
    await h.emit('before_agent_start');
    await h.assistant(`<!-- charterleaf: ${conclusion} -->`);
    await h.write(SOURCE, 'later owned implementation change');
    review(await h.settle());
    assert.equal(await h.settle(), undefined);
  });
}

test('a structurally invalid later spec change invalidates prior successful capture', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.write(SOURCE, 'owned change');
  await h.write(SPEC, CONTRACT);
  assert.match(text(await h.write(SPEC, '---\napplies_to: invalid\n---\n# Invalid later spec\n')), /structural errors/);
  const result = await h.settle();
  assert.equal(result.continue, undefined, 'bad metadata must report a limit, not pretend capture is complete');
  assert.match(result.entries.at(-1).content, /No automatic review was performed/);
});

test('opaque code changes after covered knowledge can rearm the bounded fallback', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.emit('before_agent_start');
  await h.assistant('<!-- charterleaf: covered -->');
  p.write(SOURCE, 'later opaque change');
  await h.result(h.call('bash', { command: 'opaque_writer' }));
  review(await h.settle());
});


test('standalone semantic signal survives a following rationale without repeating review', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.prime();
  await h.write(SOURCE, 'fixed bug');
  await h.assistant('Fixed and verified.\n<!-- charterleaf: covered -->\nThe existing authority already captures this boundary.');
  assert.equal(await h.settle(), undefined);
});

test('fenced examples of semantic signals never suppress real development review', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.write(SOURCE, 'new implementation');
  await h.assistant('An example:\n```html\n<!-- charterleaf: covered -->\n```\nAnother:\n~~~html\n<!-- charterleaf: no-value -->\n~~~');
  review(await h.settle());
});


test('a failed partial spec mutation cannot retain prior successful capture credit', async (t) => {
  const p = project(t, { git: true, specs: false });
  const h = api(p);
  await h.write(SOURCE, 'owned implementation');
  await h.write(SPEC, CONTRACT);
  const call = h.call('write', { path: SPEC, content: '---\napplies_to: invalid\n---\n' });
  await h.emit('tool_call', call);
  p.write(SPEC, call.input.content);
  await h.result(call, { isError: true });
  const result = await h.settle();
  assert.equal(result.continue, undefined);
  assert.match(result.entries.at(-1).content, /No automatic review was performed/);
});


test('an exact inline terminal conclusion supersedes an earlier candidate without extra review', async (t) => {
  const p = project(t, { git: true });
  const h = api(p);
  await h.write(SOURCE, 'new test under existing contract');
  await h.assistant('<!-- charterleaf: review -->\nCandidate examined. Existing routed authority already covers it. <!-- charterleaf: covered -->');
  assert.equal(await h.settle(), undefined);
});
