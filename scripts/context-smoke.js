'use strict';

// Controlled first-request cost comparison; all runs share cwd, tools and package paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const model = process.env.CHARTERLEAF_MODEL;
assert.ok(model, 'Set CHARTERLEAF_MODEL=provider/id explicitly; no model is selected automatically');
const repo = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-context-'));
const agent = path.join(temp, 'agent');
const project = path.join(temp, 'project');
const pkg = path.join(temp, 'package');
const sourceAgent = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent');
const baseline = process.env.CHARTERLEAF_BASELINE || 'HEAD';
fs.mkdirSync(agent);
fs.mkdirSync(path.join(project, 'specs'), { recursive: true });
fs.writeFileSync(path.join(agent, 'settings.json'), JSON.stringify({ defaultThinkingLevel: 'low', packages: [] }));
for (const name of ['auth.json', 'models.json']) {
  if (fs.existsSync(path.join(sourceAgent, name))) fs.copyFileSync(path.join(sourceAgent, name), path.join(agent, name));
}
for (const dir of ['extensions', 'skills', 'lib', 'bin']) fs.cpSync(path.join(repo, dir), path.join(pkg, dir), { recursive: true });
console.log(`Evidence: ${temp}`);
const results = [];
try {
  for (const variant of ['off', 'baseline', 'organic']) {
    for (const name of ['extensions/charterleaf.js', 'skills/charterleaf/runtime.md']) {
      const content = variant === 'baseline' ? execFileSync('git', ['show', `${baseline}:${name}`], { cwd: repo }) : fs.readFileSync(path.join(repo, name));
      fs.writeFileSync(path.join(pkg, name), content);
    }
    fs.writeFileSync(path.join(project, 'specs/.charterleaf.json'), JSON.stringify({ version: 1, mode: variant === 'off' ? 'off' : 'auto' }));
    const run = spawnSync(process.env.PI_BIN || 'pi', ['--mode', 'json', '--no-session', '--no-extensions',
      '--extension', path.join(pkg, 'extensions/charterleaf.js'), '--no-skills', '--no-context-files',
      '--no-prompt-templates', '--no-themes', '--no-approve', '--tools', 'read,write,edit,bash',
      '--model', model, '--thinking', 'low',
      'Reply with OK. Do not use tools.'], {
      cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: agent }, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(temp, `${variant}.jsonl`), run.stdout || '');
    fs.writeFileSync(path.join(temp, `${variant}.stderr`), run.stderr || '');
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stderr);
    const events = run.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === 'agent_settled' && !event.aborted));
    const messages = events.filter((event) => event.type === 'message_end' && event.message.role === 'assistant').map((event) => event.message);
    assert.equal(messages.length, 1, 'ordinary chat must make only one model request');
    assert.equal(events.filter((event) => event.type === 'tool_execution_start').length, 0);
    assert.ok(!['error', 'aborted'].includes(messages[0].stopReason), messages[0].errorMessage);
    const usage = messages[0].usage;
    const input = usage.input + usage.cacheRead + usage.cacheWrite;
    assert.ok(input > 0, 'provider usage is required');
    results.push({ variant, input, usage });
  }
  const off = results[0].input;
  for (const result of results) result.increment = result.input - off;
  assert.deepEqual(fs.readdirSync(path.join(project, 'specs')), ['.charterleaf.json']);
  fs.writeFileSync(path.join(temp, 'summary.json'), JSON.stringify({ baseline, model: model, results }, null, 2));
  console.log(JSON.stringify(results.map(({ variant, input, increment }) => ({ variant, input, increment })), null, 2));
} finally {
  // Never retain credentials in acceptance artifacts, including on failure.
  for (const name of ['auth.json', 'models.json']) fs.rmSync(path.join(agent, name), { force: true });
}
