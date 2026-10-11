'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const MODES = ['auto', 'confirm', 'reference', 'off'];
const CONFIG = 'specs/.charterleaf.json';

function projectRoot(cwd) {
  const start = fs.realpathSync(cwd);
  for (let current = start; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, CONFIG))) return current;
    if (path.dirname(current) === current) return start;
  }
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Resolve existing ancestors too: new files below a symlink must not escape the project.
function canonical(file, depth = 0) {
  if (depth > 40) throw new Error('Too many symlinks');
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return canonical(path.resolve(path.dirname(file), fs.readlinkSync(file)), depth + 1);
    return fs.realpathSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) return file;
    return path.join(canonical(parent, depth + 1), path.basename(file));
  }
}

function toolPath(input) {
  let value = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  if (value.startsWith('@')) value = value.slice(1);
  if (value.startsWith('file://')) value = fileURLToPath(value);
  value = value.replaceAll('\\', '/');
  if (value === '~') value = os.homedir();
  if (value.startsWith('~/')) value = path.join(os.homedir(), value.slice(2));
  if (process.platform === 'win32') {
    const drive = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive) value = `${drive[1].toUpperCase()}:/${drive[2] || ''}`;
  }
  return value;
}

function projectPath(root, cwd, input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) return null;
  let value = toolPath(input);
  if (process.platform !== 'win32' && /^[A-Za-z]:\//.test(value)) {
    value = `/mnt/${value[0].toLowerCase()}/${value.slice(3)}`;
  } else if (process.platform !== 'win32' && value.startsWith('//')) {
    // A foreign UNC host cannot safely be interpreted as a local Linux path.
    return null;
  }
  const lexical = path.resolve(cwd, value);
  const resolved = canonical(lexical);
  if (!inside(root, lexical) || !inside(root, resolved)) return null;
  return path.relative(root, resolved).replaceAll('\\', '/') || '.';
}

function readMode(root) {
  const file = path.join(root, CONFIG);
  if (!fs.existsSync(file)) return 'off';
  if (!inside(root, canonical(file))) throw new Error('Charterleaf config escapes project');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.version !== 1 || !MODES.includes(config.mode)) throw new Error('Invalid Charterleaf config (expected version: 1 and a valid mode)');
  return config.mode;
}

function saveMode(root, mode) {
  if (!MODES.includes(mode)) throw new Error('Invalid Charterleaf mode');
  const file = path.join(root, CONFIG);
  if (!inside(root, canonical(file))) throw new Error('Charterleaf config escapes project');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, mode }, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function fingerprint(root, relative) {
  const file = path.join(root, relative);
  if (!inside(root, canonical(file))) return 'outside';
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return 'not-file';
    // shortcut: over 2 MiB use size/mtime, use streaming hashes if large-file attribution is needed.
    if (stat.size > 2 * 1024 * 1024) return `large:${stat.size}:${stat.mtimeMs}`;
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

function gitSnapshot(root) {
  const git = (args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== root) return null;
    // Compare index and worktree separately; this also works before the first commit.
    const names = [git(['diff', '--no-renames', '--name-only', '-z']), git(['diff', '--cached', '--no-renames', '--name-only', '-z']),
      git(['ls-files', '--others', '--exclude-standard', '-z'])].join('\0').split('\0').filter(Boolean);
    if (names.length > 500) return null; // Bounded task checks, not a repository scan.
    const snapshot = new Map([...new Set(names)].map((name) => {
      const file = path.join(root, name);
      // Git tracks a symlink's target string, not the target file's contents.
      let stat;
      try { stat = fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const hash = stat?.isSymbolicLink() ? `symlink:${fs.readlinkSync(file)}` : fingerprint(root, name);
      return [name, hash];
    }));
    const raw = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']).split('\0');
    snapshot.index = new Map();
    for (let i = 0; i + 1 < raw.length; i += 2) snapshot.index.set(raw[i + 1], raw[i]);
    return snapshot;
  } catch {
    return null;
  }
}

function changedSince(before, after) {
  if (!before || !after) return [];
  return [...new Set([...before.keys(), ...after.keys()])].filter((name) =>
    (before.get(name) ?? 'clean') !== (after.get(name) ?? 'clean') ||
    before.index?.get(name) !== after.index?.get(name)).sort();
}

module.exports = { CONFIG, MODES, projectRoot, projectPath, toolPath, readMode, saveMode, fingerprint, gitSnapshot, changedSince };
