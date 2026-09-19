'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIREMENT_ID_SOURCE = String.raw`\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,}\b`;
const REQUIREMENT_HEADING = /^#{2,6}\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,})\b/;
const SECTION_HEADING = /^##\s+(ADD|MODIFY|REMOVE|PRESERVE)\s*$/i;

class FrontmatterError extends Error {}

function normalizeRepoPath(value) {
  let result = String(value).trim().replaceAll('\\', '/');
  while (result.startsWith('./')) result = result.slice(2);
  result = result.replace(/\/+/g, '/');
  while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
  return result || '.';
}

function unquote(value) {
  if (
    value.length >= 2 &&
    value[0] === value[value.length - 1] &&
    (value[0] === '"' || value[0] === "'")
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function inlineList(value) {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((part) => {
    const item = unquote(part.trim());
    if (!item) throw new FrontmatterError('empty inline list item');
    return item;
  });
}

function parseFrontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') {
    return { frontmatter: null, body: String(text) };
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index;
      break;
    }
  }
  if (end === -1) throw new FrontmatterError('unclosed frontmatter');

  const data = {};
  let currentList = null;
  for (let index = 1; index < end; index += 1) {
    const raw = lines[index];
    const number = index + 1;
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;

    const stripped = raw.trimStart();
    const indent = raw.length - stripped.length;
    if (indent) {
      if (currentList === null || !stripped.startsWith('- ')) {
        throw new FrontmatterError(`line ${number}: unsupported indentation`);
      }
      const item = unquote(stripped.slice(2).trim());
      if (!item) throw new FrontmatterError(`line ${number}: empty list item`);
      data[currentList].push(item);
      continue;
    }

    currentList = null;
    const colon = raw.indexOf(':');
    if (colon === -1) throw new FrontmatterError(`line ${number}: expected 'key: value'`);
    const key = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      throw new FrontmatterError(`line ${number}: invalid key`);
    }
    if (Object.hasOwn(data, key)) {
      throw new FrontmatterError(`line ${number}: duplicate key ${key}`);
    }

    if (!value) {
      data[key] = [];
      currentList = key;
      continue;
    }

    const parsedList = inlineList(value);
    data[key] = parsedList === null ? unquote(value) : parsedList;
  }

  return { frontmatter: data, body: lines.slice(end + 1).join('\n') };
}

function escapeRegexChar(char) {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function globMatches(pattern, targetPath) {
  const normalizedPattern = normalizeRepoPath(pattern);
  const normalizedPath = normalizeRepoPath(targetPath);
  const parts = normalizedPattern.split('/');
  let source = '^';

  parts.forEach((part, index) => {
    if (part === '**') {
      source += index === parts.length - 1 ? '.*' : '(?:[^/]+/)*';
      return;
    }

    for (const char of part) {
      source += char === '*' ? '[^/]*' : escapeRegexChar(char);
    }
    if (index !== parts.length - 1) source += '/';
  });

  source += '$';
  return new RegExp(source).test(normalizedPath);
}

function walkMarkdown(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
  }
  walk(root);
  return files.sort((a, b) => {
    const left = a.replaceAll('\\', '/');
    const right = b.replaceAll('\\', '/');
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function relativeDisplay(filePath, cwd) {
  const relative = path.relative(cwd, filePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replaceAll('\\', '/');
  return filePath.replaceAll('\\', '/');
}

function write(stream, line) {
  stream.write(`${line}\n`);
}

function related(repoPath, cwd = process.cwd(), streams = {}) {
  const stdout = streams.stdout || process.stdout;
  const stderr = streams.stderr || process.stderr;
  const specRoot = path.join(cwd, 'specs');
  if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
    write(stderr, 'ERROR specs/: not found');
    return 2;
  }

  const target = normalizeRepoPath(repoPath);
  const documents = [];
  const errors = [];

  for (const filePath of walkMarkdown(specRoot)) {
    const display = relativeDisplay(filePath, cwd);
    let parsed;
    try {
      parsed = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      errors.push(`ERROR ${display}: ${error.message}`);
      continue;
    }
    documents.push({
      filePath,
      display,
      relative: path.relative(specRoot, filePath).replaceAll('\\', '/'),
      frontmatter: parsed.frontmatter || {},
    });
  }

  const livingSpecs = documents.filter((document) => isLivingSpec(document.filePath, specRoot));
  const scoped = [];
  for (const document of livingSpecs) {
    const patterns = document.frontmatter.applies_to;
    if (patterns === undefined) continue;
    if (!Array.isArray(patterns) || !patterns.every((item) => typeof item === 'string')) {
      errors.push(`ERROR ${document.display}: applies_to must be a list of paths`);
      continue;
    }
    if (patterns.some((pattern) => globMatches(pattern, target))) scoped.push(document);
  }

  if (errors.length) {
    for (const error of errors) write(stderr, error);
    return 2;
  }

  const matchedIds = new Set();
  for (const document of scoped) {
    const id = typeof document.frontmatter.id === 'string' ? document.frontmatter.id.trim() : '';
    if (id) matchedIds.add(id);
  }

  const activeChanges = [];
  if (matchedIds.size) {
    const changeRoot = path.join(specRoot, 'changes');
    for (const document of documents) {
      if (path.dirname(document.filePath) !== changeRoot) continue;
      const affects = document.frontmatter.affects;
      if (!Array.isArray(affects)) continue;
      if (affects.some((specId) => typeof specId === 'string' && matchedIds.has(specId.trim()))) {
        activeChanges.push(document.display);
      }
    }
  }

  scoped.sort((left, right) => (left.display < right.display ? -1 : left.display > right.display ? 1 : 0));
  activeChanges.sort();

  const blocks = [];
  const constitution = documents.find((document) => document.relative === 'constitution.md');
  if (constitution) blocks.push(['Global', [`  ${constitution.display}`]]);
  if (scoped.length) {
    blocks.push(['Scoped', scoped.map((document) => `  ${document.display}`)]);
  } else {
    blocks.push(['Scoped', ['  No applies_to glob matched this path.']]);
  }
  if (activeChanges.length) {
    blocks.push(['Active changes', activeChanges.map((change) => `  ${change}`)]);
  }
  if (!scoped.length && livingSpecs.length) {
    const lines = [];
    livingSpecs.forEach((document, index) => {
      if (index) lines.push('');
      const id = typeof document.frontmatter.id === 'string' ? document.frontmatter.id.trim() : '';
      const appliesTo = Array.isArray(document.frontmatter.applies_to)
        ? document.frontmatter.applies_to.join(', ')
        : String(document.frontmatter.applies_to ?? '');
      lines.push(`  ${id || '(missing id)'}`);
      lines.push(`    ${document.display}`);
      lines.push(`    applies_to: ${appliesTo}`);
    });
    blocks.push(['Available living specs', lines]);
  }

  blocks.forEach(([title, lines], index) => {
    if (index) write(stdout, '');
    write(stdout, title);
    for (const line of lines) write(stdout, line);
  });
  return 0;
}

function isLivingSpec(filePath, specRoot) {
  const relative = path.relative(specRoot, filePath).replaceAll('\\', '/').split('/');
  return relative.length >= 2 && (relative[0] === 'capabilities' || relative[0] === 'engineering');
}

function requirementDefinitions(text) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(REQUIREMENT_HEADING);
    if (match) found.push(match[1]);
  }
  return found;
}

function stripHtmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}

function changeSections(body) {
  const sections = new Map();
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.trim().match(SECTION_HEADING);
    if (heading) {
      current = heading[1].toUpperCase();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (line.startsWith('## ')) {
      current = null;
      continue;
    }
    if (current !== null) sections.get(current).push(line);
  }
  return Object.fromEntries([...sections].map(([name, lines]) => [name, lines.join('\n')]));
}

function allRequirementIds(text) {
  return [...String(text).matchAll(new RegExp(REQUIREMENT_ID_SOURCE, 'g'))].map((match) => match[0]);
}

function lint(cwd = process.cwd(), streams = {}) {
  const stdout = streams.stdout || process.stdout;
  const stderr = streams.stderr || process.stderr;
  const specRoot = path.join(cwd, 'specs');
  if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
    write(stderr, 'ERROR specs/: not found');
    return 2;
  }

  const errors = [];
  const parsed = new Map();
  const ids = new Map();
  const livingRequirements = new Map();
  const requirementsBySpecId = new Map();
  const changeTouches = new Map();
  const paths = walkMarkdown(specRoot);

  for (const filePath of paths) {
    const display = relativeDisplay(filePath, cwd);
    let result;
    try {
      result = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
      parsed.set(filePath, result);
    } catch (error) {
      errors.push([display, `invalid frontmatter: ${error.message}`]);
      continue;
    }

    const frontmatter = result.frontmatter || {};
    const living = isLivingSpec(filePath, specRoot);
    const change = path.dirname(filePath) === path.join(specRoot, 'changes');

    if (living) {
      const rawSpecId = frontmatter.id;
      if (typeof rawSpecId !== 'string' || !rawSpecId.trim()) {
        errors.push([display, 'missing spec id']);
      } else {
        const specId = rawSpecId.trim();
        if (ids.has(specId)) {
          errors.push([display, `duplicate spec id ${specId} (also in ${relativeDisplay(ids.get(specId), cwd)})`]);
        } else {
          ids.set(specId, filePath);
        }
      }

      if (!Object.hasOwn(frontmatter, 'applies_to')) {
        errors.push([display, 'missing applies_to']);
      } else if (Array.isArray(frontmatter.applies_to) && frontmatter.applies_to.length === 0) {
        errors.push([display, 'applies_to must contain at least one path']);
      }
    }

    for (const field of ['applies_to', 'tags']) {
      if (Object.hasOwn(frontmatter, field)) {
        const value = frontmatter[field];
        if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
          errors.push([display, `${field} must be a list of strings`]);
        }
      }
    }

    if (Object.hasOwn(frontmatter, 'affects')) {
      const value = frontmatter.affects;
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) {
        errors.push([display, 'affects must be a list of spec ids']);
      }
    }

    if (change && !Object.hasOwn(frontmatter, 'affects')) {
      errors.push([display, 'missing affects']);
    } else if (change && Array.isArray(frontmatter.affects) && frontmatter.affects.length === 0) {
      errors.push([display, 'affects must contain at least one spec id']);
    }

    if (living) {
      const requirementIds = requirementDefinitions(result.body);
      livingRequirements.set(filePath, requirementIds);
      const counts = new Map();
      for (const reqId of requirementIds) counts.set(reqId, (counts.get(reqId) || 0) + 1);
      for (const [reqId, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (count > 1) errors.push([display, `duplicate requirement id ${reqId}`]);
      }
    }
  }

  const globalRequirements = new Map();
  for (const [filePath, reqIds] of livingRequirements) {
    for (const reqId of [...new Set(reqIds)].sort()) {
      if (!globalRequirements.has(reqId)) globalRequirements.set(reqId, []);
      globalRequirements.get(reqId).push(filePath);
    }
  }
  for (const [reqId, reqPaths] of [...globalRequirements].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (reqPaths.length > 1) {
      const first = reqPaths[0];
      for (const filePath of reqPaths.slice(1)) {
        errors.push([
          relativeDisplay(filePath, cwd),
          `duplicate requirement id ${reqId} (also in ${relativeDisplay(first, cwd)})`,
        ]);
      }
    }
  }

  for (const [specId, filePath] of ids) {
    requirementsBySpecId.set(specId, new Set(livingRequirements.get(filePath) || []));
  }

  const allExistingRequirements = new Set(globalRequirements.keys());
  for (const filePath of paths) {
    if (path.dirname(filePath) !== path.join(specRoot, 'changes') || !parsed.has(filePath)) continue;
    const display = relativeDisplay(filePath, cwd);
    const { frontmatter: rawFrontmatter, body } = parsed.get(filePath);
    const frontmatter = rawFrontmatter || {};
    const sections = changeSections(body);
    const hasDelta = ['ADD', 'MODIFY', 'REMOVE'].some(
      (section) => stripHtmlComments(sections[section] || '').trim().length > 0,
    );
    if (!hasDelta) {
      errors.push([display, 'change must contain at least one ADD, MODIFY, or REMOVE section']);
    }

    const affects = frontmatter.affects;
    if (!Array.isArray(affects) || !affects.every((item) => typeof item === 'string' && item.length > 0)) {
      continue;
    }

    const affectedRequirements = new Set();
    let anyKnown = false;
    for (const specId of affects) {
      if (!ids.has(specId)) {
        errors.push([display, `unknown spec id ${specId}`]);
      } else {
        anyKnown = true;
        for (const reqId of requirementsBySpecId.get(specId) || []) affectedRequirements.add(reqId);
      }
    }

    for (const section of ['ADD', 'MODIFY', 'REMOVE']) {
      for (const reqId of new Set(allRequirementIds(sections[section] || ''))) {
        if (!changeTouches.has(reqId)) changeTouches.set(reqId, new Map());
        const byFile = changeTouches.get(reqId);
        if (!byFile.has(display)) byFile.set(display, new Set());
        byFile.get(display).add(section);
      }
    }

    if (anyKnown) {
      for (const section of ['MODIFY', 'REMOVE']) {
        for (const reqId of [...new Set(allRequirementIds(sections[section] || ''))].sort()) {
          if (!affectedRequirements.has(reqId)) {
            errors.push([display, `${section} unknown requirement id ${reqId}`]);
          }
        }
      }
    }
    for (const reqId of [...new Set(allRequirementIds(sections.ADD || ''))].sort()) {
      if (allExistingRequirements.has(reqId)) {
        errors.push([display, `ADD existing requirement id ${reqId}`]);
      }
    }
  }

  for (const [reqId, byFile] of [...changeTouches].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (byFile.size < 2) continue;
    const entries = [...byFile].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const touches = entries.map(
      ([display, sections]) => `${display}: ${[...sections].sort().join('/')}`,
    );
    errors.push([
      entries[0][0],
      `conflicting active changes for ${reqId}: ${touches.join('; ')}`,
    ]);
  }

  errors.sort((a, b) => {
    const left = a[0] === b[0] ? a[1] : a[0];
    const right = a[0] === b[0] ? b[1] : b[0];
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const [display, message] of errors) write(stdout, `ERROR ${display}: ${message}`);
  if (errors.length) {
    write(stdout, `${errors.length} structural errors`);
    return 1;
  }
  write(stdout, '0 structural errors');
  return 0;
}

function helpText() {
  return [
    'Usage: charterleaf <command> [args]',
    '',
    'Commands:',
    '  related <path>  find durable constraints matching a repo-relative path',
    '  lint            report structural errors in specs/',
  ].join('\n');
}

function usageError(message, streams = {}) {
  const stderr = streams.stderr || process.stderr;
  if (message) write(stderr, `ERROR: ${message}`);
  write(stderr, helpText());
  return 2;
}

function main(argv = process.argv.slice(2), cwd = process.cwd(), streams = {}) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    write(streams.stdout || process.stdout, helpText());
    return 0;
  }
  if (!argv.length) return usageError('a command is required', streams);

  const [command, ...rest] = argv;
  if (command === 'related') {
    if (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h')) {
      write(streams.stdout || process.stdout, 'Usage: charterleaf related <path>');
      return 0;
    }
    if (rest.length !== 1) return usageError('related requires exactly one path', streams);
    return related(rest[0], path.resolve(cwd), streams);
  }
  if (command === 'lint') {
    if (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h')) {
      write(streams.stdout || process.stdout, 'Usage: charterleaf lint');
      return 0;
    }
    if (rest.length) return usageError('lint takes no arguments', streams);
    return lint(path.resolve(cwd), streams);
  }
  return usageError(`unknown command ${command}`, streams);
}

module.exports = {
  FrontmatterError,
  changeSections,
  globMatches,
  lint,
  main,
  normalizeRepoPath,
  parseFrontmatter,
  related,
  requirementDefinitions,
};
