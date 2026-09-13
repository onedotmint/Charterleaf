'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { main } = require('../lib/charterleaf.js');

const CAPABILITY = `---
id: auth.session
applies_to:
  - src/auth/**
  - tests/auth/*
tags:
  - auth
---
# Session

## Requirements

### AUTH-001 — Login
The system MUST create a session.

### AUTH-002 — Logout
The system MUST invalidate a session.
`;

const ENGINEERING = `---
id: engineering.backend
applies_to:
  - src/**/*.ts
---
# Backend

## Requirements

### ENG-BE-002 — Boundary
Domain code MUST stay framework independent.
`;

class Project {
  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'charterleaf-'));
    for (const name of ['capabilities', 'engineering', 'decisions', 'changes']) {
      fs.mkdirSync(path.join(this.root, 'specs', name), { recursive: true });
    }
    fs.writeFileSync(path.join(this.root, 'specs', 'constitution.md'), '# Constitution\n', 'utf8');
  }

  write(relative, content) {
    const filePath = path.join(this.root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  run(...argv) {
    let out = '';
    let err = '';
    const streams = {
      stdout: { write(chunk) { out += chunk; } },
      stderr: { write(chunk) { err += chunk; } },
    };
    const code = main(argv, this.root, streams);
    return { code, out, err };
  }

  close() {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

function withProject(fn) {
  const project = new Project();
  try {
    project.write('specs/capabilities/auth.md', CAPABILITY);
    return fn(project);
  } finally {
    project.close();
  }
}

test('map: lists the specification layers and metadata', () => withProject((project) => {
  project.write('specs/engineering/backend.md', ENGINEERING);
  project.write('specs/decisions/0001-domain-boundary.md', '# Domain boundary\n');
  project.write('specs/changes/session-lifetime.md', '---\naffects:\n  - auth.session\n---\n# Session lifetime\n');
  const { code, out, err } = project.run('map');
  assert.equal(code, 0);
  assert.equal(err, '');
  assert.equal(out,
    'Constitution\n' +
    '  specs/constitution.md\n' +
    '\n' +
    'Capabilities\n' +
    '  auth.session\n' +
    '    specs/capabilities/auth.md\n' +
    '    applies_to: src/auth/**, tests/auth/*\n' +
    '\n' +
    'Engineering\n' +
    '  engineering.backend\n' +
    '    specs/engineering/backend.md\n' +
    '    applies_to: src/**/*.ts\n' +
    '\n' +
    'Decisions\n' +
    '  specs/decisions/0001-domain-boundary.md\n' +
    '\n' +
    'Active changes\n' +
    '  specs/changes/session-lifetime.md\n' +
    '    affects: auth.session\n');
}));

test('map: is stable regardless of file creation order', () => {
  function outputFor(order) {
    const project = new Project();
    try {
      for (const name of order) {
        project.write(`specs/capabilities/${name}.md`, `---\nid: ${name}.scope\napplies_to:\n  - src/${name}/**\n---\n# ${name}\n`);
      }
      return project.run('map').out;
    } finally {
      project.close();
    }
  }

  const first = outputFor(['zeta', 'alpha']);
  const second = outputFor(['alpha', 'zeta']);
  assert.equal(first, second);
  assert.ok(first.indexOf('alpha.scope') < first.indexOf('zeta.scope'));
});

test('map: never prints specification bodies', () => withProject((project) => {
  project.write('specs/capabilities/auth.md', `${CAPABILITY}\n### AUTH-003 — Secret body marker\nTHIS_TEXT_MUST_NOT_APPEAR_IN_MAP_OUTPUT\n`);
  const { code, out } = project.run('map');
  assert.equal(code, 0);
  assert.doesNotMatch(out, /THIS_TEXT_MUST_NOT_APPEAR_IN_MAP_OUTPUT/);
}));

test('map: malformed frontmatter is a clear runtime error', () => withProject((project) => {
  project.write('specs/engineering/broken.md', '---\nid: broken\n');
  const { code, out, err } = project.run('map');
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.match(err, /ERROR specs\/engineering\/broken\.md: unclosed frontmatter/);
}));

test('map: missing specs directory is a runtime error', () => withProject((project) => {
  fs.rmSync(path.join(project.root, 'specs'), { recursive: true });
  const { code, out, err } = project.run('map');
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.equal(err, 'ERROR specs/: not found\n');
}));

test('map: validates CLI arguments', () => withProject((project) => {
  let result = project.run('map', '--help');
  assert.equal(result.code, 0);
  assert.equal(result.out, 'Usage: charterleaf map\n');
  assert.equal(result.err, '');

  result = project.run('map', 'unexpected-arg');
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.err, /ERROR: map takes no arguments/);
}));

test('related: single match', () => withProject((project) => {
  const { code, out, err } = project.run('related', 'src/auth/session.ts');
  assert.equal(code, 0);
  assert.equal(out, 'specs/capabilities/auth.md\n');
  assert.equal(err, '');
}));

test('related: multiple matches and stable order', () => withProject((project) => {
  project.write('specs/engineering/backend.md', ENGINEERING);
  const { code, out } = project.run('related', 'src/auth/session.ts');
  assert.equal(code, 0);
  assert.equal(out, 'specs/capabilities/auth.md\nspecs/engineering/backend.md\n');
}));

test('related: star matches one segment', () => withProject((project) => {
  let result = project.run('related', 'tests/auth/test_session.py');
  assert.equal(result.code, 0);
  assert.match(result.out, /specs\/capabilities\/auth\.md/);
  result = project.run('related', 'tests/auth/unit/test_session.py');
  assert.equal(result.code, 0);
  assert.equal(result.out, 'No related specs.\n');
}));

test('related: double star matches nested segments', () => withProject((project) => {
  const { code, out } = project.run('related', 'src/auth/deep/session.ts');
  assert.equal(code, 0);
  assert.match(out, /specs\/capabilities\/auth\.md/);
}));

test('related: Windows path normalization', () => withProject((project) => {
  const { code, out } = project.run('related', String.raw`src\auth\session.ts`);
  assert.equal(code, 0);
  assert.match(out, /specs\/capabilities\/auth\.md/);
}));

test('related: no match is success', () => withProject((project) => {
  const { code, out, err } = project.run('related', 'src/billing/invoice.ts');
  assert.equal(code, 0);
  assert.equal(out, 'No related specs.\n');
  assert.equal(err, '');
}));

test('related: malformed frontmatter is clear runtime error', () => withProject((project) => {
  project.write('specs/engineering/broken.md', '---\nid: broken\n');
  const { code, out, err } = project.run('related', 'src/auth/session.ts');
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.match(err, /ERROR specs\/engineering\/broken\.md: unclosed frontmatter/);
}));

function withLintProject(fn) {
  return withProject((project) => {
    project.write('specs/engineering/backend.md', ENGINEERING);
    return fn(project);
  });
}

test('lint: valid project', () => withLintProject((project) => {
  const { code, out, err } = project.run('lint');
  assert.equal(code, 0);
  assert.equal(out, '0 errors\n');
  assert.equal(err, '');
}));

test('lint: missing spec id', () => withLintProject((project) => {
  project.write('specs/capabilities/missing-id.md', '---\napplies_to:\n  - src/**\n---\n# Missing id\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /missing spec id/);
}));

test('lint: missing applies_to on living spec', () => withLintProject((project) => {
  project.write('specs/capabilities/missing-scope.md', '---\nid: missing.scope\n---\n# Missing scope\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /ERROR specs\/capabilities\/missing-scope\.md: missing applies_to/);
}));

test('lint: empty applies_to on living spec', () => withLintProject((project) => {
  project.write('specs/capabilities/empty-scope.md', '---\nid: empty.scope\napplies_to: []\n---\n# Empty scope\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /ERROR specs\/capabilities\/empty-scope\.md: applies_to must contain at least one path/);
}));

test('lint: accepts a non-empty applies_to on living spec', () => withProject((project) => {
  const { code, out } = project.run('lint');
  assert.equal(code, 0);
  assert.equal(out, '0 errors\n');
}));

test('lint: engineering specs require applies_to', () => withLintProject((project) => {
  project.write('specs/engineering/missing-scope.md', '---\nid: engineering.missing\n---\n# Missing scope\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /ERROR specs\/engineering\/missing-scope\.md: missing applies_to/);
}));

test('lint: non-living specs do not require applies_to', () => withLintProject((project) => {
  project.write('specs/decisions/0001-boundary.md', '# Boundary\n');
  project.write('specs/changes/change.md', '---\naffects:\n  - auth.session\n---\n# Change\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 0);
  assert.equal(out, '0 errors\n');
}));

test('lint: duplicate spec id', () => withLintProject((project) => {
  project.write('specs/engineering/duplicate.md', '---\nid: auth.session\napplies_to:\n  - src/**\n---\n# Duplicate\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /duplicate spec id auth\.session/);
}));

test('lint: duplicate requirement id in same file', () => withLintProject((project) => {
  project.write('specs/capabilities/auth.md', `${CAPABILITY}\n### AUTH-001 — Again\n`);
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /duplicate requirement id AUTH-001/);
}));

test('lint: duplicate requirement id across living specs', () => withLintProject((project) => {
  project.write('specs/engineering/backend.md', `${ENGINEERING}\n### AUTH-001 — Wrong duplicate\n`);
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /duplicate requirement id AUTH-001/);
}));

test('lint: invalid frontmatter', () => withLintProject((project) => {
  project.write('specs/capabilities/broken.md', '---\nid broken\n---\n# Broken\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /invalid frontmatter/);
}));

test('lint: invalid applies_to', () => withLintProject((project) => {
  project.write('specs/capabilities/bad-scope.md', '---\nid: bad.scope\napplies_to: src/**\n---\n# Bad\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /applies_to must be a list of strings/);
}));

test('lint: invalid tags', () => withLintProject((project) => {
  project.write('specs/capabilities/bad-tags.md', '---\nid: bad.tags\ntags: auth\n---\n# Bad\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /tags must be a list of strings/);
}));

test('lint: change references unknown spec', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects:\n  - auth.sessions\n---\n# Change\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /unknown spec id auth\.sessions/);
}));

test('lint: MODIFY unknown requirement', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects:\n  - auth.session\n---\n# Change\n\n## MODIFY\n\n### AUTH-999 — Missing\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /MODIFY unknown requirement id AUTH-999/);
}));

test('lint: REMOVE unknown requirement', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects:\n  - auth.session\n---\n# Change\n\n## REMOVE\n\n- AUTH-999\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /REMOVE unknown requirement id AUTH-999/);
}));

test('lint: ADD existing requirement', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects:\n  - auth.session\n---\n# Change\n\n## ADD\n\n### AUTH-001 — Already exists\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /ADD existing requirement id AUTH-001/);
}));

test('lint: valid delta change', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects:\n  - auth.session\n---\n# Rotation\n\n## ADD\n\n### AUTH-003 — Rotate\n\n## MODIFY\n\n### AUTH-001 — Login\n\n## REMOVE\n\n- AUTH-002\n\n## PRESERVE\n\n- API stays stable.\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 0);
  assert.equal(out, '0 errors\n');
}));

test('lint: missing affects', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '# Change\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /missing affects/);
}));

test('lint: empty affects', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects:\n---\n# Change\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /affects must contain at least one spec id/);
}));

test('lint: invalid affects type', () => withLintProject((project) => {
  project.write('specs/changes/change.md', '---\naffects: auth.session\n---\n# Change\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /affects must be a list of spec ids/);
}));

test('related: includes active change affecting a matched spec', () => withProject((project) => {
  project.write('specs/changes/session-rotation.md', '---\naffects:\n  - auth.session\n---\n# Rotation\n\n## MODIFY\n\n### AUTH-001 — Login\n');
  const { code, out, err } = project.run('related', 'src/auth/session.ts');
  assert.equal(code, 0);
  assert.equal(out, 'specs/capabilities/auth.md\nspecs/changes/session-rotation.md\n');
  assert.equal(err, '');
}));

test('related: appends all relevant active changes after direct matches in stable order', () => withLintProject((project) => {
  project.write('specs/changes/z-backend.md', '---\naffects:\n  - engineering.backend\n---\n# Backend change\n');
  project.write('specs/changes/a-session.md', '---\naffects:\n  - auth.session\n---\n# Session change\n');
  const { code, out } = project.run('related', 'src/auth/session.ts');
  assert.equal(code, 0);
  assert.equal(out,
    'specs/capabilities/auth.md\n' +
    'specs/engineering/backend.md\n' +
    'specs/changes/a-session.md\n' +
    'specs/changes/z-backend.md\n');
}));

test('related: does not include active changes for unrelated specs', () => withProject((project) => {
  project.write('specs/capabilities/billing.md', '---\nid: billing.invoice\napplies_to:\n  - src/billing/**\n---\n# Billing\n');
  project.write('specs/changes/billing-change.md', '---\naffects:\n  - billing.invoice\n---\n# Billing change\n');
  const { code, out } = project.run('related', 'src/auth/session.ts');
  assert.equal(code, 0);
  assert.equal(out, 'specs/capabilities/auth.md\n');
}));

test('lint: conflicting active changes MODIFY and REMOVE same requirement', () => withLintProject((project) => {
  project.write('specs/changes/modify-timeout.md', '---\naffects:\n  - auth.session\n---\n# Modify\n\n## MODIFY\n\n### AUTH-002 — Logout\n');
  project.write('specs/changes/remove-timeout.md', '---\naffects:\n  - auth.session\n---\n# Remove\n\n## REMOVE\n\n- AUTH-002\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /conflicting active changes for AUTH-002/);
  assert.match(out, /specs\/changes\/modify-timeout\.md: MODIFY/);
  assert.match(out, /specs\/changes\/remove-timeout\.md: REMOVE/);
  assert.match(out, /1 errors\n$/);
}));

test('lint: conflicting active changes ADD same requirement', () => withLintProject((project) => {
  project.write('specs/changes/add-rotation-a.md', '---\naffects:\n  - auth.session\n---\n# Add A\n\n## ADD\n\n### AUTH-003 — Rotation\n');
  project.write('specs/changes/add-rotation-b.md', '---\naffects:\n  - auth.session\n---\n# Add B\n\n## ADD\n\n### AUTH-003 — Different rotation\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 1);
  assert.match(out, /conflicting active changes for AUTH-003/);
  assert.match(out, /add-rotation-a\.md: ADD/);
  assert.match(out, /add-rotation-b\.md: ADD/);
}));

test('lint: separate active changes touching different requirements are valid', () => withLintProject((project) => {
  project.write('specs/changes/change-login.md', '---\naffects:\n  - auth.session\n---\n# Login\n\n## MODIFY\n\n### AUTH-001 — Login\n');
  project.write('specs/changes/change-logout.md', '---\naffects:\n  - auth.session\n---\n# Logout\n\n## MODIFY\n\n### AUTH-002 — Logout\n');
  const { code, out } = project.run('lint');
  assert.equal(code, 0);
  assert.equal(out, '0 errors\n');
}));
