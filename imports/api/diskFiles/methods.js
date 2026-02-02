import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const EXCLUDED_DIRS = new Set([
  'node_modules', '.meteor', '.git', '.next', '.nuxt',
  'dist', 'build', '.cache', '__pycache__', '.venv',
]);

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss',
  '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.lua', '.sql',
  '.graphql', '.gql', '.env', '.gitignore', '.editorconfig', '.eslintrc',
  '.prettierrc', '.babelrc', '.dockerignore', '.dockerfile',
  '.makefile', '.cmake', '.gradle', '.sbt', '.ex', '.exs', '.erl',
  '.hs', '.ml', '.mli', '.r', '.jl', '.pl', '.pm', '.php', '.vue',
  '.svelte', '.astro', '.mdx', '.rst', '.tex', '.csv', '.tsv', '.log',
  '.lock', '.prisma', '.proto',
]);

// Files without extensions that are typically text
const TEXT_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile',
  'Procfile', 'LICENSE', 'CHANGELOG', 'README', 'CONTRIBUTING',
  'AUTHORS', 'CLAUDE.md',
]);

const isTextFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const basename = path.basename(filePath);
  if (TEXT_FILENAMES.has(basename)) return true;
  // No extension files are often text (scripts, etc.)
  if (!ext) return true;
  return false;
};

const expandTilde = (p) => {
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
};

const validateAbsolutePath = (filePath) => {
  if (!path.isAbsolute(filePath)) {
    throw new Meteor.Error('invalid-path', 'Path must be absolute');
  }
};

Meteor.methods({
  async 'diskFile.read'(filePath) {
    check(filePath, String);
    filePath = expandTilde(filePath);
    validateAbsolutePath(filePath);

    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) {
      throw new Meteor.Error('not-found', `File not found: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Meteor.Error('not-file', 'Path is not a regular file');
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Meteor.Error('too-large', `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }
    if (!isTextFile(filePath)) {
      throw new Meteor.Error('binary-file', 'File does not appear to be a text file');
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    return {
      content,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      basename: path.basename(filePath),
      filePath,
    };
  },

  async 'diskFile.write'(filePath, content) {
    check(filePath, String);
    check(content, String);
    filePath = expandTilde(filePath);
    validateAbsolutePath(filePath);

    // Only allow writing to existing files (no creation)
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Meteor.Error('not-found', 'File must already exist on disk');
    }

    await fs.promises.writeFile(filePath, content, 'utf8');
    const newStat = await fs.promises.stat(filePath);
    return { mtime: newStat.mtime.toISOString() };
  },

  async 'diskFile.listDir'(dirPath, options = {}) {
    check(dirPath, String);
    check(options, Match.Optional(Object));
    dirPath = expandTilde(dirPath);
    validateAbsolutePath(dirPath);

    const showHidden = options?.showHidden || false;

    const stat = await fs.promises.stat(dirPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Meteor.Error('not-directory', `Not a directory: ${dirPath}`);
    }

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      // Skip hidden files unless requested
      if (!showHidden && entry.name.startsWith('.')) continue;
      // Skip heavy directories
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      let entryStat;
      try {
        entryStat = await fs.promises.stat(fullPath);
      } catch {
        continue; // Skip broken symlinks etc.
      }

      results.push({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: entryStat.size,
        mtime: entryStat.mtime.toISOString(),
      });
    }

    // Sort: directories first, then files, alphabetical within each group
    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  },
});
