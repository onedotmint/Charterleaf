# Charterleaf

A lightweight agent-native constraint layer for coding agents.

**Code is implementation. Tests are verification. Specs are durable constraints.
Charterleaf connects them.**

Given a concrete repository path, Charterleaf answers one question:

> Which durable constraints should I read before touching this code?

Durable project intent, deterministic routing, and structural linting —
with opt-in native Pi integration, without workflow orchestration.

## Two layers

Charterleaf sits beside a project's own navigation, not on top of it.

- **A project reference protocol** — a tracked `AGENTS.md` entry plus
  the project's own documents — tells an agent *where* authoritative
  information lives: current state, validation, resources, history,
  source roots.
- **Charterleaf** tells an agent *which durable constraints* matter when
  work lands on a specific repository path.

Charterleaf complements project navigation; it does not replace
project-owned sources of state, evidence, or workflow. It stores and
routes durable constraints; it never becomes the owner of a fact that
belongs to a project file.

## Install

Install once in Pi to discover the bundled Extension and Skill:

```bash
pi install npm:@onedotmint/charterleaf
```

For the standalone CLI, use `npm install -g @onedotmint/charterleaf`.
For local development, use `pi install /absolute/path/to/charterleaf` (a package
directory, not a `.tgz` file). To test the CLI from a local package, run `npm pack`
then `npm install -g ./onedotmint-charterleaf-0.4.1.tgz`.

Restart Pi or run `/reload` after installation, then use `/charterleaf` in each
project you want to enable. To stop automation, choose **Not Enable** in that
menu. To remove the global package, use `pi remove npm:@onedotmint/charterleaf`
(or the same local directory source used for installation); project docs remain.

A Pi-only install needs no second global npm install: the Extension calls Core
directly and supplies the bundled CLI entry point for optional manual checks.

The **Core/CLI** runs standalone on Node.js **20+**, has no dependencies,
and requires no Pi. The **Pi Extension** is tested against
`@earendil-works/pi-coding-agent` **1.1.0** and uses `agent_before_settle`:
it requires a host with that compatible Extension API, not just any Pi
version. That Pi host requires Node.js **22.19.0+**; the Core's lower
minimum does not make older Node versions suitable for the host.

## Native Pi modes

Run `/charterleaf` in Pi for the native project mode menu:

| Choice | Behavior |
| --- | --- |
| **Auto** (recommended) | Read constraints; maintain only justified durable knowledge. |
| **Confirm** | Read automatically; approve each exact standard spec write/edit. |
| **Reference** | Read and check; report proposals or conflicts, never modify specs. |
| **Not Enable** | Turn automation off; keep existing documents. |

The choice is saved immediately in `specs/.charterleaf.json`:

```json
{ "version": 1, "mode": "off" }
```

Valid modes are `auto`, `confirm`, `reference`, and `off`. Missing config
means **off**; existing `specs/` alone never enables automation. Activation
is an explicit user choice, not an Agent decision. Enabling creates only
this config (and its directory if needed), not a constitution or a pile
of spec documents. Disabling preserves documents; cancel changes nothing.
Disabled/unconfigured projects get no automatic adoption prompt, task
context, scan, or document bootstrap. Manual CLI use is independent of
this config.

Without UI, saved Auto and Reference modes still read/check constraints;
Confirm denies spec mutations because approval is unavailable. A refused identical
proposal does not reopen an approval dialog in the same task; a new user task
can make a fresh proposal. The
`/charterleaf` menu does nothing without UI.

## Architecture and task behavior

- **Core** (`lib/charterleaf.js`) exports `resolveRelated` for structured
  deterministic routing shared with the CLI. This adds no CLI command
  and requires no spec-format migration.
- **Extension** (`extensions/charterleaf.js`, with `lib/project.js`) uses
  native command, task/context, tool-call/result, compaction and settlement
  hooks for opt-in loading, write gates, mode approval and a final review.
- **Skill** (`skills/charterleaf/SKILL.md`) supplies semantic judgment and
  maintenance discipline. It is not a deterministic semantic validator.

For known paths, standard `read` results carry the applicable constraint
bodies without replacing the original result. A standard code `write` or
`edit` with unseen constraints is blocked, carrying the constraints or
an explicit read request. Read and assess them, then retry; do not evade
this gate via Bash. Delivery counts as loaded only at the **next model
request**, not when a parallel sibling tool finishes.

Automatic spec bodies have a **24,000-byte budget per task** and an
**8,000-byte per-file limit**. Larger files or exhausted budgets require
an explicit complete `read`; a partial/truncated read is not full
knowledge. Native Pi offset pages are credited only when their exact content
covers the same spec version with no gaps; ordinary prose about truncation does
not count as a tool truncation notice. On a scoped miss, the Extension supplies metadata only for
available living specs, capped at 12 entries and 2,000 characters;
`charterleaf related <path>` provides the full routing list. A miss never
proves that no constraints apply.

Compact rules from `skills/charterleaf/runtime.md` are supplied once per
project/session branch; the full `SKILL.md` authoring/CLI guide stays on demand.
Each task adds only its current mode/root. Same-version spec bodies already
seen in the retained branch are reused across tasks, while ownership, Git
baseline and body budget are reset per task. Switching branches or compaction
clears context-delivery bookkeeping.
Routing is recomputed through Core for each concrete path check, so new scopes
and changed globs are not hidden by stale routing caches. Changed spec content
requires fresh delivery; successful standard spec writes invalidate loaded state.
Compaction invalidates loaded context so constraints must be delivered
again. This is task-local bookkeeping, not a watcher or persistent index.

Knowledge capture happens **during normal work**, not just after code changes:
development, debugging, substantive code/test/architecture investigation and
accepted technical decisions can establish or uncover durable knowledge. A project
with only `specs/.charterleaf.json` is a valid initial state. When evidence warrants
it, the Agent creates a concise scoped spec using ordinary authorized `write`/`edit`;
Core immediately routes its `id`/`applies_to` on later related code reads or edits.
There is no initialization scan, document quota or adoption wizard.

At successful, actionable `agent_before_settle`, the Extension may request
**at most one final semantic review per task**. Actual development remains a
fallback, but an unresolved evidenced knowledge candidate can also trigger it
without file changes or Git. The existing Agent makes the semantic judgment; the
Extension observes standalone assistant lifecycle comments outside fenced examples
(`charterleaf: review` or an explicit `covered`/`no-value`/`proposed` knowledge
conclusion; an exact terminal conclusion also works inline), never interprets read
counts as knowledge. A generic `done` cannot suppress the development fallback.
In an empty-spec project, a development fallback
remains eligible when the Agent says `no-value`; this gives the existing single
review a chance to catch a missed discovery gap. These are
cooperative intent signals, not evidence or permissions. Already judged/captured,
proposed or effectively documented knowledge needs no repeat review when a
completion signal is observed. If the Agent
omits its completion signal, the bounded fallback can repeat an already answered
knowledge judgment; zero redundant reviews is not guaranteed. Successful
structurally valid standard spec writes mark capture complete; later actual code
edits or distinct candidates may rearm. Opaque activity after capture still uses
bounded Git comparison when available. Ordinary views, queries and chat do not
by themselves request another model call.

For the development fallback, the Extension separates successful standard-tool
paths whose observed content is still
unchanged from **unattributed** changes observed against the task's Git
baseline. Neither a touched file nor a dirty worktree proves ownership
of every line. Preserve existing user dirt and parallel work; unattributed
changes alone must not justify spec edits. No automatic revert, stage,
commit or push is performed.

**No justified durable knowledge means no spec edit.** Distinguish **newly
established** contracts/decisions from **newly discovered** existing constraints;
both can qualify even in a code-read-only investigation. Require reliable evidence
(accepted decisions, authoritative docs, tests or sufficiently verified behavior),
future mistake-prevention value, and a documentation/discoverability gap. If an
existing authoritative document covers it, prefer a short routed reference when
needed; otherwise do nothing. Keep non-obvious contracts, invariants, boundaries,
pitfalls or accepted decisions — not code summaries, progress, debugging logs,
temporary plans/todos or speculation. Current code alone is not an accepted
correct contract. Explicit **no-file-write/read-only** instructions override Auto:
report a finding/proposal without writing. Confirm/Reference retain their existing
permissions. A
code/spec conflict is not permission to accommodate incorrect code:
distinguish implementation bugs, authoritatively obsolete specs and
explicitly intended contract changes. When uncertain, preserve the spec
and report the conflict. This review does not start an independent
workflow or another development cycle.

## CLI

Charterleaf exposes exactly two deterministic commands. Run them from a
repository root containing `specs/`:

```bash
charterleaf related <path>
charterleaf lint
```

There is no `map` command. Discovery is handled by a scoped miss (below)
and by the project's own reference protocol.

### related \<path\>

Routes the supplied repo-relative path (`/` or `\` separators) to durable
constraints:

- `specs/constitution.md` is **Global**: returned whenever it exists,
  regardless of frontmatter. It needs no `id` and no `applies_to`.
- `capabilities/` and `engineering/` specs are **Scoped**: returned when
  any `applies_to` glob matches.
- Active changes whose `affects` reference a matched spec id are appended
  under `Active changes`.

```text
Global
  specs/constitution.md

Scoped
  specs/capabilities/auth.md
```

`applies_to` is a deterministic routing hint, not a completeness proof.
"No match" only ever means "no living spec's `applies_to` glob matched
this path" — never "no constraints apply". When nothing matches, the
command states that explicitly and lists available living specs by `id`,
path, and `applies_to` only, so discovery stays possible without reading
every spec:

```text
Global
  specs/constitution.md

Scoped
  No applies_to glob matched this path.

Available living specs
  auth.session
    specs/capabilities/auth.md
    applies_to: src/auth/**

  engineering.backend
    specs/engineering/backend.md
    applies_to: src/**/*.ts
```

`related` never inspects the filesystem for the supplied path; it accepts
the caller's repo-relative string. A scoped miss is success (exit code
0), not an error.

### lint

```bash
charterleaf lint
```

`lint` performs mechanical structural checks only: frontmatter shape,
living Spec IDs, required `applies_to` on living specs, duplicate spec
and requirement IDs, change references, static `ADD` / `MODIFY` /
`REMOVE` references, changes whose `ADD` / `MODIFY` / `REMOVE` sections
are all empty (HTML comments do not count), and conflicting active
changes that touch the same requirement ID. Success prints
`0 structural errors`.

`lint` does **not** verify:

- semantic correctness;
- code/spec agreement;
- routing coverage;
- project compliance;
- whether a change is actually complete;
- whether an Agent read the specs.

## Project knowledge

```text
specs/
├── constitution.md
├── capabilities/
├── engineering/
├── decisions/
└── changes/
```

- `constitution.md` — rare project-wide durable boundaries. Global
  constraint; not routed by `applies_to`.
- `capabilities/` — durable observable behavior, contracts, invariants,
  non-goals.
- `engineering/` — durable implementation boundaries, long-lived
  constraints, recurring pitfalls, verification practice.
- `decisions/` — important architectural rationale and revisit
  conditions.
- `changes/` — optional staging for an accepted but not-yet-implemented
  contract. See below.

## Writing specs

A spec records a constraint whose absence would plausibly cause a future
developer or agent to make a wrong decision. It should be non-obvious,
durable, **already true or explicitly accepted**, evidenced, mistake-preventing,
and not already effectively documented. Good fits: contracts,
invariants, architecture boundaries, non-goals, recurring pitfalls,
accepted rationale, verification constraints.

Do not write specs for current state, future design, aspirations, todos,
implementation plans, session notes, progress, temporary debugging,
navigation, or history. What you hope to become is a plan, not a living
spec.

## changes/ is optional staging

Use `specs/changes/<name>.md` only when an accepted future contract must
temporarily coexist with current living reality — for example when
implementation happens in another session or by another agent, human
review comes first, or a multi-step migration is underway. A change must
contain at least one of `ADD`, `MODIFY`, `REMOVE`; `PRESERVE` alone is
not a change.

Otherwise, implement/verify as needed and maintain the living spec when durable
truth changed **or an existing valuable constraint lacks effective documentation**. After an accepted change is implemented, merge the durable
result into living specs and delete the change file. Git keeps history.

## Agent conventions

The complete Agent convention lives in
[`skills/charterleaf/SKILL.md`](skills/charterleaf/SKILL.md): adoption
and ownership, progressive retrieval, `related` and `lint` semantics,
mode behavior, spec writing discipline, and durable learning.

For agents that read project instructions, the minimal reference
bootstrap is [`AGENTS_SNIPPET.md`](AGENTS_SNIPPET.md).

Charterleaf core does not depend on Pi. Any coding agent that can read
Markdown and run shell commands can use it.

## Boundaries

Charterleaf has no project state/task system, planning or workflow
orchestration, memory/evidence/history management, scope/owner registry,
project bootstrap command, semantic search/embeddings, coverage analyzer,
database, persistent index, daemon, watcher or independent AI service.
The Extension uses the host lifecycle and lightweight Git snapshots;
it does not become a session manager or Git workflow.

Important limits:

- Bash, external writers and opaque/custom tools cannot be fully
  intercepted. Reference and Confirm are **not security sandboxes**;
  use standard `write`/`edit` for all spec changes.
- In non-Git projects, standard-tool observations still work, but opaque
  changes cannot be reliably discovered or attributed; final review falls
  back to conversation evidence. Git snapshots do not detect gitignored
  files; standard tool observations can still identify directly touched
  paths. Neither mechanism proves ownership of all content.
- Custom/nested tool integrations depend on compatible host forwarding
  and queue support. Where supported, constraint notes must survive into
  the model-visible result while original content, images and structured
  results are preserved. Do not assume every custom envelope does this;
  read large specs directly with standard `read` and offset pages rather than relying on
  a nested wrapper that can hide or truncate their bodies.
- `lint` checks structure only. Skill-guided reviews are model judgments
  and may misjudge relevance, durable value or a conflict; neither proves
  semantic correctness or compliance.
- Paths support repo-relative or same-project absolute paths, `/` or `\`
  separators, Pi's `@path`/`file://` aliases, and Windows drive paths mapped
  to `/mnt/<drive>/` on WSL. Enabled standard tools execute the normalized
   path that was checked; spec authorization also preserves the original path's
   protected identity when a spec symlink points elsewhere inside the project.
  Foreign UNC paths are not interpreted as local paths; symlink escapes are
  rejected for project spec writes. Native Windows behavior needs platform testing.
- `related` has no filesystem awareness of the supplied target path and
  no proof of routing coverage. Task-local hashes are not a continuous
  monitor of external changes. A single spec line larger than Pi's read byte
  limit cannot be credited as read; do not keep retrying or bypass the gate —
  report it and ask for readable formatting or a user-chosen mode change.
  Files over 2 MiB use coarse size/mtime fingerprints;
  Git checks exceeding 500 changed/untracked entries fall back to conversation
  evidence instead of scanning a large worktree.

The two CLI commands remain helpers, not workflow gates. Native tool
gates apply only to the opt-in Pi integration, within the limits above.

## Development

Core development requires Node.js 20 or newer; there are no runtime or
development dependencies and no build step. Use the higher Node/host
requirements above for Pi smoke checks.

Verification commands:

```bash
npm test
npm run test:pi   # isolated real RPC/UI smoke; no model calls
CHARTERLEAF_MODEL=deepseek/deepseek-flash npm run test:organic  # paid isolated A–G acceptance
CHARTERLEAF_MODEL=deepseek/deepseek-flash CHARTERLEAF_BASELINE=5d470db npm run test:context  # paid comparison against v0.4.0
node scripts/organic-smoke.js --self-test  # harness/oracle check, no model calls
node --test tests/extension.test.js
npm pack --dry-run
node bin/charterleaf.js related extensions/charterleaf.js
node bin/charterleaf.js lint
```

Validated on Node.js 24.21.0 and Pi 1.1.0: 183 automated Core/Extension tests,
structural lint, dry-run npm packaging, and real Pi RPC loading/native selection
for cancellation, mode changes, disable and cross-process restore. The RPC smoke
uses isolated temporary projects/settings and makes no model calls.

The 0.4.1 organic-capture acceptance used real `deepseek/deepseek-flash` sessions
in isolated Git projects. Actual tool results, approval records, specs, routing,
file snapshots/diffs, original tests and an independent exact-money oracle were
checked, not just assistant claims. Empty-spec development and investigation,
ordinary-query non-triggers, authoritative-document references, bug-versus-contract
handling, cross-session reuse and mode/read-only/no-UI permissions all have passing
evidence. **The strict matrix was not consistently all-green:** the latest focused
A→F1→F2 run passed A and F1, while F2 omitted its knowledge-completion comment and
received one redundant fallback review. Its actual routing, code behavior and
unchanged-spec checks passed. These bounded examples do not prove model reliability
on every task or provider, or guarantee zero redundant reviews.

The controlled organic-capture comparison (`scripts/context-smoke.js`) keeps cwd,
package paths, prompt and native tools identical. On `deepseek/deepseek-flash`:
disabled 1,616 input tokens; v0.4.0 baseline 2,036 (increment 420); organic runtime
2,142 (increment 526), or **106 additional fixed input tokens**. Input here includes
cached input. Each chat made exactly one request and no tool calls; the full Skill
remains on demand. Absolute path tokenization and provider tokenizers vary, and
cache-hit sizes affect uncached charges, so these are measured examples, not fixed
billing guarantees. The script defaults to `HEAD`; set `CHARTERLEAF_BASELINE` to the
older revision being compared (the command above uses the v0.4.0 release commit).
Substantive work requests **zero or at most one** extra model review: observed
capture/coverage/proposal completion skips the fallback; empty-spec development can
still get the one fallback after a `no-value` judgment.

The real-model acceptance script retains raw RPC/JSONL, conversations, actual tool
records, before/after files, tracked/untracked diffs, validation output and individual
assertions in the printed private temporary directory, including failures. It copies
credentials only to isolated settings and removes that copy on normal/error
completion; a forced process kill may require deleting the private credential
copy manually. It does not
import personal extensions/instructions or modify other repositories, and it is not
an OS security sandbox. Both paid scripts require explicit `CHARTERLEAF_MODEL=provider/id`; neither chooses
another provider automatically. The requested model must be available;
`--case A,B,...` selects bounded scenarios. F cases run A first, then B only if A failed to capture; they reuse only
model-written knowledge in the same project across fresh sessions. A's failure
remains a failed assertion; a successful B→F chain does not conceal it. Model usage counts visible assistant responses, not hidden
provider HTTP retries. Cost fixtures also remove copied credentials on exit.

For an interactive smoke check in a disposable project, install the local
package in a compatible Pi host and run `/charterleaf`: check immediate
mode persistence, cancel/disable preserving documents, constraint loading
on a standard read, a blocked unseen-constraint write followed by retry,
Confirm approve/refuse, and Reference denying spec writes. After a
substantive edit, check that at most one final review occurs and that no
durable change leaves specs untouched. Also check saved modes without UI:
Auto/Reference still read, Confirm denies spec writes, and the menu is
inactive. Automated hook tests do not substitute for this real-host smoke.

## License

MIT
