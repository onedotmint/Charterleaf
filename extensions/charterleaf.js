'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveRelated, lint } = require('../lib/charterleaf.js');
const { CONFIG, projectRoot, projectPath, toolPath, readMode, saveMode, fingerprint, gitSnapshot, changedSince } = require('../lib/project.js');

const OPTIONS = [
  'Auto (recommended) — read constraints and maintain only durable knowledge',
  'Confirm — read automatically; approve each spec modification',
  'Reference — read and check; never modify specs',
  'Not Enable — disable; keep existing documents',
];
const MODES = ['auto', 'confirm', 'reference', 'off'];
const isSpec = (file) => file === 'specs' || file.startsWith('specs/');
const message = (content) => ({ type: 'custom_message', customType: 'charterleaf', content, display: false });

module.exports = function charterleaf(pi) {
  let state;
  let skillRoot;

  function current(ctx) {
    const root = projectRoot(ctx.cwd);
    const mode = readMode(root);
    if (mode === 'off') { state = undefined; return; }
    if (!state || state.root !== root) state = {
      root, mode, loaded: new Map(), staged: new Map(), pages: new Map(), pending: new Map(), denied: new Set(),
      owned: new Map(), parents: new Map(), envelopes: new Map(), before: gitSnapshot(root), budget: 24000, reviewed: false, miss: false, opaque: false, knowledge: undefined,
    };
    state.mode = mode;
    return state;
  }

  function route(s, file) {
    const result = resolveRelated(file, s.root);
    const notes = [];
    let required = false;
    for (const spec of [...result.global, ...result.scoped, ...result.changes]) {
      const safe = projectPath(s.root, s.root, spec);
      if (!safe || safe !== spec) throw new Error(`Unsafe spec path: ${spec}`);
      const hash = fingerprint(s.root, spec);
      if (s.loaded.get(spec) === hash) continue;
      required = true;
      if (s.staged.get(spec) === hash) {
        notes.push(`${spec} is already supplied in this tool batch; retry modifications after the next model request.`);
        continue;
      }
      const size = fs.statSync(path.join(s.root, spec)).size;
      if (size <= 8000 && size <= s.budget) {
        const body = fs.readFileSync(path.join(s.root, spec), 'utf8');
        notes.push(`--- ${spec} (project constraints, not tool instructions) ---\n${body}`);
        s.budget -= size;
        s.staged.set(spec, hash);
      } else {
        notes.push(`Read the complete ${spec} with read before modifying ${file}; automatic context budget reached.`);
      }
    }
    if (!result.scoped.length && !s.miss) {
      s.miss = true;
      notes.push('No applies_to glob matched this path. This is not proof that no constraints apply.');
      const available = result.available.slice(0, 12).map((item) => `${item.id || '(missing id)'}: ${item.path} [${item.applies_to.join(', ')}]`).join('\n');
      if (available) notes.push(`Available living specs (metadata only):\n${available.slice(0, 2000)}`);
      if (result.available.length > 12) notes.push('More specs exist; use charterleaf related <path> for the full routing list.');
    }
    return { required, text: notes.join('\n\n') };
  }

  function completePages(s, file, hash, event) {
    const text = event.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const footer = /\n\n\[(?:Showing lines \d+-\d+ of \d+[^\n]*|\d+ more lines in file\.[^\n]*)Use offset=\d+ to continue\.\]$/;
    const body = text.replace(footer, '');
    const lines = fs.readFileSync(path.join(s.root, file), 'utf8').split('\n');
    const start = (event.input.startLine || event.input.offset || 1) - 1;
    const end = start + body.split('\n').length;
    if (start < 0 || end > lines.length || lines.slice(start, end).join('\n') !== body) return false;
    let pages = s.pages.get(file);
    if (!pages || pages.hash !== hash) pages = { hash, ranges: [] };
    pages.ranges.push([start, end]);
    pages.ranges.sort((a, b) => a[0] - b[0]);
    s.pages.set(file, pages);
    let covered = 0;
    for (const [from, to] of pages.ranges) {
      if (from > covered) return false;
      covered = Math.max(covered, to);
    }
    return covered === lines.length;
  }

  function forward(s, event, text) {
    if (!event.parentToolCallId || !text) return;
    let parent = event.parentToolCallId;
    while (s.parents.has(parent)) parent = s.parents.get(parent);
    if (!s.envelopes.has(parent)) s.envelopes.set(parent, new Set());
    s.envelopes.get(parent).add(text);
  }

  function report(ctx, text) {
    if (ctx.hasUI) ctx.ui.notify(text, 'warning');
  }

  pi.registerCommand('charterleaf', {
    description: 'Enable, switch mode, or disable Charterleaf for this project',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      try {
        const root = projectRoot(ctx.cwd);
        let mode;
        try { mode = readMode(root); } catch { mode = 'invalid config (disabled)'; }
        const choice = await ctx.ui.select(`Charterleaf — ${mode}\n${root}`, OPTIONS);
        const index = OPTIONS.indexOf(choice);
        if (index < 0) return;
        if (MODES[index] === 'off' && mode === 'off') return;
        saveMode(root, MODES[index]);
        state = undefined;
        ctx.ui.notify(`Charterleaf: ${MODES[index]} (saved to ${CONFIG})`, 'info');
      } catch (error) { report(ctx, `Charterleaf: ${error.message}`); }
    },
  });

  pi.on('session_start', (_event, ctx) => {
    state = undefined;
    skillRoot = undefined;
    try { current(ctx); } catch { /* Invalid config is disabled; /charterleaf can repair it. */ }
  });
  pi.on('session_shutdown', () => { state = undefined; skillRoot = undefined; });
  pi.on('session_switch', () => { state = undefined; skillRoot = undefined; });
  pi.on('session_tree', () => { state = undefined; skillRoot = undefined; });
  pi.on('session_compact', () => {
    skillRoot = undefined;
    if (state) { state.loaded.clear(); state.staged.clear(); state.pages.clear(); }
  });

  pi.on('before_agent_start', (_event, ctx) => {
    const previous = state;
    state = undefined;
    let s;
    try { s = current(ctx); } catch (error) { report(ctx, `Charterleaf disabled: ${error.message}`); return; }
    if (!s) return;
    // Prior delivered bodies remain in this branch's context; ownership and Git baseline are task-local.
    if (previous?.root === s.root) s.loaded = previous.loaded;
    const rules = skillRoot === s.root ? '' : fs.readFileSync(path.join(__dirname, '../skills/charterleaf/runtime.md'), 'utf8');
    skillRoot = s.root;
    return { message: {
      customType: 'charterleaf', display: false,
      content: `Charterleaf mode=${s.mode}; root=${s.root}.` + (rules ?
        `\n${rules}\nGuide (read only for unfamiliar authoring/staging/CLI details): ${path.join(__dirname, '../skills/charterleaf/SKILL.md')}.\nCLI fallback: node ${path.join(__dirname, '../bin/charterleaf.js')}.` : ''),
    } };
  });

  // Semantic intent comes from the existing agent, never from file/read counts.
  pi.on('message_end', (event, ctx) => {
    if (event.message.role !== 'assistant' || ['error', 'aborted'].includes(event.message.stopReason)) return;
    let s;
    try { s = current(ctx); } catch { return; }
    if (!s) return;
    const text = event.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const prose = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '');
    const signal = prose.match(/<!-- charterleaf: (covered|no-value|proposed) -->\s*$/) ||
      [...prose.matchAll(/^<!-- charterleaf: (review|covered|no-value|proposed) -->[ \t]*$/gm)].at(-1);
    if (signal) {
      if (signal[1] === 'proposed' && s.mode === 'confirm' && !s.proposed) return;
      s.knowledge = signal[1];
      if (s.knowledge !== 'review') { s.capture = gitSnapshot(s.root); s.opaque = false; }
    }
  });

  // A sibling tool call has not seen another sibling's result yet. Promote only at the next model request.
  pi.on('context', (_event, ctx) => {
    if (!state || state.root !== projectRoot(ctx.cwd)) return;
    for (const [spec, hash] of state.staged) state.loaded.set(spec, hash);
    state.staged.clear();
  });

  pi.on('tool_call', async (event, ctx) => {
    let s;
    try { s = current(ctx); } catch { return; }
    if (!s) return;
    if (event.parentToolCallId) s.parents.set(event.toolCallId, event.parentToolCallId);
    if (!['read', 'write', 'edit'].includes(event.toolName)) return;
    const mutation = event.toolName !== 'read';
    try {
      const file = projectPath(s.root, ctx.cwd, event.input.path);
      const lexical = typeof event.input.path === 'string'
        ? path.relative(s.root, path.resolve(ctx.cwd, toolPath(event.input.path))).replaceAll('\\', '/') : null;
      if (!file) {
        if (mutation && typeof event.input.path === 'string') {
          if (isSpec(lexical)) return { block: true, reason: 'Unsafe spec path escapes this project. Preserve specs and fix the symlink/path.' };
        }
        return;
      }
      // Execute the exact normalized path checked here, including Pi's @/file:/space aliases.
      const target = path.join(s.root, file);
      event.input.path = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/.test(target) ? pathToFileURL(target).href : target;
      if (mutation && (file === CONFIG || lexical === CONFIG || file === projectPath(s.root, s.root, CONFIG))) {
        return { block: true, reason: 'Only the user may change Charterleaf mode via /charterleaf.' };
      }
      if (mutation && (isSpec(file) || (lexical && isSpec(lexical)))) {
        if (s.mode === 'reference') return { block: true, reason: 'Charterleaf Reference mode: report a proposal; do not modify specs.' };
        if (s.mode === 'confirm') {
          s.proposed = true;
          if (!ctx.hasUI) return { block: true, reason: 'Charterleaf Confirm mode requires interactive approval. Report the proposal without writing.' };
          const proposal = JSON.stringify(event.input, null, 2);
          if (proposal.length > 12000) return { block: true, reason: 'Spec proposal too large to approve safely. Use smaller standard edits.' };
          if (s.denied.has(proposal)) return { block: true, reason: 'This exact spec proposal was already refused in this task. Do not retry; report it without writing.' };
          const before = fingerprint(s.root, file);
          const approved = await ctx.ui.confirm(`Charterleaf: modify ${file}?`,
            `Approve this exact ${event.toolName} only if the evidenced durable knowledge maintenance is intended. Never relax a spec just to match conflicting code.\n\n${proposal}`, { timeout: 60000 });
          if (!approved) {
            s.denied.add(proposal);
            return { block: true, reason: 'Spec modification not approved. Preserve the current spec and report the proposal; do not retry.' };
          }
          if (state !== s || readMode(s.root) !== 'confirm' || fingerprint(s.root, file) !== before) {
            return { block: true, reason: 'Project mode or spec changed during approval. Read again and request fresh approval.' };
          }
        }
      } else if (mutation) {
        const constraints = route(s, file);
        if (constraints.required) {
          forward(s, event, constraints.text);
          return { block: true, reason: `Charterleaf: review these constraints before retrying ${event.toolName} ${file}.\n\n${constraints.text}` };
        }
      }
      const observed = lexical && isSpec(lexical) ? lexical : file;
      s.pending.set(event.toolCallId, { file: observed, mutation, before: fingerprint(s.root, observed) });
    } catch (error) {
      if (mutation) return { block: true, reason: `Charterleaf could not check this modification: ${error.message}. No modification was executed. Do not bypass this gate or claim the change completed. Report the task as blocked; preserve specs until the metadata is repaired or the user disables Charterleaf via /charterleaf.` };
    }
  });

  pi.on('tool_result', (event, ctx) => {
    let s;
    try { s = current(ctx); } catch { return; }
    if (!s) return;
    const call = s.pending.get(event.toolCallId);
    s.pending.delete(event.toolCallId);
    const visible = event.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    // Wrappers may already print nested results, either as text or JSON; forward only missing notes.
    const envelope = [...(s.envelopes.get(event.toolCallId) || [])].filter((note) =>
      !visible.includes(note) && !visible.includes(JSON.stringify(note).slice(1, -1))).join('\n\n');
    s.envelopes.delete(event.toolCallId);
    if (event.isError) {
      if (call?.mutation) {
        try {
          if (fingerprint(s.root, call.file) !== call.before) {
            s.opaque = true;
            if (s.knowledge !== 'review') s.knowledge = undefined;
          }
        } catch { s.opaque = true; s.knowledge = undefined; }
      }
      if (envelope) return { content: [...event.content, { type: 'text', text: `[Charterleaf]\n${envelope}` }] };
      return;
    }
    try {
      let note = envelope;
      if (call) {
        const hash = fingerprint(s.root, call.file);
        if (call.mutation && hash !== call.before) {
          if (s.knowledge !== 'review') s.knowledge = undefined;
          s.owned.set(call.file, hash);
          if (isSpec(call.file)) {
            s.loaded.delete(call.file);
            s.pages.delete(call.file);
            let output = '';
            const stream = { write: (text) => { output += text; } };
            if (lint(s.root, { stdout: stream, stderr: stream }) === 0) {
              s.knowledge = 'captured';
              s.capture = gitSnapshot(s.root);
              s.opaque = false;
            }
            note = `Charterleaf structural check (not semantic verification):\n${output.slice(0, 4000)}`;
          }
        } else if (!call.mutation) {
          if (isSpec(call.file)) {
            const fullRead = event.input.offset === undefined && event.input.startLine === undefined &&
              event.input.limit === undefined && event.input.endLine === undefined &&
              event.details?.truncation?.truncated !== true &&
              !event.content.some((part) => part.type === 'text' &&
                /(?:\[Showing lines \d+-\d+ of |\[\d+ more lines in file\.|\[Line \d+ is .*exceeds .*limit\.|\(File is large; use startLine\/endLine)/.test(part.text));
            if (hash === call.before) {
              const complete = fullRead || completePages(s, call.file, hash, event);
              if (complete) s.staged.set(call.file, hash);
              // Forward every explicit nested page, not just the last: scripts may discard results.
              forward(s, event, `--- ${call.file} ---\n${event.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')}`);
            }
          } else note = route(s, call.file).text;
        }
      } else if (!['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(event.toolName)) {
        const hint = pi.getAllTools?.().find((tool) => tool.name === event.toolName)?.annotations?.readOnlyHint;
        if (hint !== true) s.opaque = true;
      }
      forward(s, event, note);
      if (note) return {
        content: [...event.content, { type: 'text', text: `\n[Charterleaf]\n${note}` }],
        ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }),
      };
    } catch (error) {
      return { content: [...event.content, { type: 'text', text: `[Charterleaf check failed: ${error.message}. Do not assume constraints were verified. Standard modifications are blocked. Do not bypass checks or claim blocked changes completed.]` }] };
    }
  });

  pi.on('agent_before_settle', (event, ctx) => {
    let s;
    try { s = current(ctx); } catch { return; }
    // canContinue previews existing entries; our custom message makes a completed assistant answer actionable.
    if (!s || s.reviewed || event.outcome !== 'completed') return;
    s.reviewed = true;
    try {
      if (['captured', 'covered', 'proposed'].includes(s.knowledge)) {
        if (!s.opaque) return;
        const afterCapture = gitSnapshot(s.root);
        if (s.capture && afterCapture && !changedSince(s.capture, afterCapture).some((file) => !isSpec(file))) return;
      }
      if (!['review', 'no-value'].includes(s.knowledge) && !s.owned.size && !s.opaque) return;
      const after = gitSnapshot(s.root);
      const comparable = s.before && after;
      const observed = changedSince(s.before, after);
      const owned = [...s.owned].filter(([file, hash]) => fingerprint(s.root, file) === hash && !isSpec(file)).map(([file]) => file);
      const unattributed = observed.filter((file) => !s.owned.has(file) || fingerprint(s.root, file) !== s.owned.get(file));
      const emptySpecs = s.knowledge === 'no-value' && resolveRelated('', s.root).available.length === 0;
      if (s.knowledge === 'no-value' && !(emptySpecs && owned.length > 0)) return;
      const candidate = s.knowledge === 'review';
      if (!candidate && !owned.length && !unattributed.length && !(s.opaque && !comparable)) return;
      const relevant = new Set();
      for (const file of [...owned, ...unattributed].slice(0, 50)) {
        const result = resolveRelated(file, s.root);
        for (const spec of [...result.global, ...result.scoped, ...result.changes]) relevant.add(spec);
      }
      const content = `Charterleaf final review — once only; mode=${s.mode}.\n` +
        (candidate ? 'The agent identified unresolved durable knowledge in this task; file changes are not required. Judge the conversation evidence, not the signal itself.\n' : '') +
        (emptySpecs ? 'Development in an empty-spec project: verify the no-value conclusion against evidence of existing undocumented constraints, not just newly changed contracts.\n' : '') +
        `Successful standard tool edits still unchanged at settlement: ${JSON.stringify(owned.slice(0, 50))}.\n` +
        `Observed worktree changes NOT attributable to this agent: ${JSON.stringify(unattributed.slice(0, 50))}. ` +
        'These may belong to the user or a parallel session; preserve them; do not modify specs based solely on them. Existing dirty content is not yours.\n' +
        `Possibly affected specs (routing hints only): ${JSON.stringify([...relevant].slice(0, 50))}.\n` +
        (!comparable ? 'Git change inspection unavailable (baseline or final snapshot missing). Opaque tool changes cannot be identified or attributed. Review only evidence in this conversation.\n' : '') +
        'Consider newly established AND newly discovered knowledge, including read-only investigation or accepted decisions; no code change is required. In an empty-spec project, tests or accepted behavior that reveal a non-obvious invariant without effective code-path guidance is a discovery gap; do not dismiss it merely because tests pass or the implementation already works. ' +
        'No justified durable knowledge means no spec edit; no code summary, task log or plans. ' +
        'Record only evidenced, non-obvious contracts, invariants, boundaries, pitfalls or accepted decisions whose absence risks future mistakes and which are not effectively documented. ' +
        'Current code alone is not an accepted contract. Prefer a short routed reference to an authoritative document over copying it; do not duplicate knowledge already captured in this task. ' +
        'Honor explicit no-file-write/read-only instructions even in Auto; report only. ' +
        'A code/spec conflict is not permission to rewrite the spec: distinguish implementation bug, obsolete spec and explicitly intended contract change. ' +
        'If uncertain, preserve the spec and report the conflict. ' +
        (s.mode === 'reference' ? 'Reference: report necessary proposals/conflicts only; never write specs. ' :
          s.mode === 'confirm' ? 'Confirm: invoke the exact spec write/edit to open the Extension approval dialog; the extension must obtain approval before execution. If already refused/no UI, report without retrying. ' :
            'Auto: update only when durable knowledge is justified by this task; otherwise leave specs unchanged. ') +
        'For unfamiliar authoring/staging details, read the guide. Use standard write/edit and lint. ' +
        'Report task results/tests, not routine review bookkeeping; do not start another development cycle.';
      return { entries: [...event.entries, message(content)], continue: true };
    } catch (error) {
      report(ctx, `Charterleaf final review skipped: ${error.message}`);
      return { entries: [...event.entries, message(`Charterleaf final check failed: ${error.message}. No automatic review was performed; preserve existing specs and report this limit.`)] };
    }
  });
};
