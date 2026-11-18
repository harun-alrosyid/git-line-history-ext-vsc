import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type ParentCommit = {
  hash: string;
  author: string;
  date: Date | null;
  summary: string;
  line: string;
};

export type LineCommit = {
  hash: string;
  origin: string | null;
  author: string;
  date: Date | null;
  summary: string;
  isUncommitted?: boolean;
  parent?: ParentCommit;
};

type ParentInfo = {
  hash: string;
  author: string;
  date: Date | null;
  summary: string;
};

const rootCache = new Map<string, string | null>();
const remoteCache = new Map<string, string | null>();
const parentInfoCache = new Map<string, ParentInfo | null>();

function setCacheWithLimit<K, V>(map: Map<K, V>, key: K, value: V, max = 500): void {
  if (map.size >= max) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

export function clearGitCache(): void {
  rootCache.clear();
  remoteCache.clear();
  parentInfoCache.clear();
}

async function getRepoRoot(cwd: string): Promise<string | null> {
  if (rootCache.has(cwd)) return rootCache.get(cwd)!;

  // Hierarchical lookup: check if cwd is inside an already known repository root
  for (const [knownDir, root] of rootCache.entries()) {
    if (root && (cwd === knownDir || cwd.startsWith(knownDir + path.sep))) {
      setCacheWithLimit(rootCache, cwd, root);
      return root;
    }
  }

  try {
    const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd });
    const root = stdout.trim();
    setCacheWithLimit(rootCache, root, root);
    setCacheWithLimit(rootCache, cwd, root);
    return root;
  } catch {
    setCacheWithLimit(rootCache, cwd, null);
    return null;
  }
}

async function getRemoteOrigin(root: string): Promise<string | null> {
  if (remoteCache.has(root)) return remoteCache.get(root)!;
  try {
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: root });
    const origin = stdout.trim();
    setCacheWithLimit(remoteCache, root, origin);
    return origin;
  } catch {
    setCacheWithLimit(remoteCache, root, null);
    return null;
  }
}

export function parseBlame(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('\t')) break;
    const separator = line.indexOf(' ');
    if (separator > 0) {
      result[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return result;
}

function getDate(fields: Record<string, string>): Date | null {
  const timestamp = Number(fields['author-time']);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null;
}

export async function lineCommit(
  filePath: string,
  line: number,
  options?: { includeParent?: boolean }
): Promise<LineCommit | null> {
  let resolvedPath = filePath;
  try {
    resolvedPath = fs.realpathSync(filePath);
  } catch {}

  const cwd = path.dirname(resolvedPath);
  const root = await getRepoRoot(cwd);
  if (!root) return null;

  const relative = path.relative(root, resolvedPath).replace(/\\/g, '/');
  const origin = await getRemoteOrigin(root);

  let output: string;
  try {
    output = (await exec('git', ['blame', '--line-porcelain', '-L', `${line + 1},${line + 1}`, '--', relative], { cwd: root })).stdout;
  } catch {
    return null;
  }

  const fields = parseBlame(output);
  const firstLine = output.split(/\r?\n/, 1)[0] || '';
  const hash = firstLine.split(' ')[0] || '';
  if (!hash) return null;

  const isUncommitted = /^0+$/.test(hash);
  const author = isUncommitted ? 'You' : (fields.author || 'Unknown');
  const summary = isUncommitted ? 'Uncommitted changes' : (fields.summary || '');
  const date = isUncommitted ? null : getDate(fields);

  if (!options?.includeParent) {
    return { hash, origin, author, date, summary, isUncommitted };
  }

  // Handle parent details for hover
  if (isUncommitted) {
    let parentHash: string | undefined;
    let parentFile = relative;
    if (fields['previous']) {
      const parts = fields['previous'].split(' ');
      parentHash = parts[0];
      if (parts[1]) parentFile = parts[1];
    } else {
      try {
        const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
        parentHash = stdout.trim();
      } catch {}
    }

    if (!parentHash) {
      return { hash, origin, author, date, summary, isUncommitted };
    }

    let parentLine = '(line did not exist)';
    try {
      const parentLines = (await exec('git', ['show', `${parentHash}:${parentFile}`], { cwd: root })).stdout.split(/\r?\n/);
      parentLine = parentLines[line] ?? '(line did not exist)';
    } catch {}

    let parentAuthor = 'Unknown';
    let parentDate: Date | null = null;
    let parentSummary = '';
    try {
      const parentFields = (await exec('git', ['show', '-s', '--format=%an%x00%aI%x00%s', parentHash], { cwd: root })).stdout.split('\0');
      parentAuthor = parentFields[0] || 'Unknown';
      parentDate = parentFields[1] ? new Date(parentFields[1]) : null;
      parentSummary = parentFields[2] || '';
    } catch {}

    return {
      hash,
      origin,
      author,
      date,
      summary,
      isUncommitted,
      parent: {
        hash: parentHash,
        author: parentAuthor,
        date: parentDate,
        summary: parentSummary,
        line: parentLine,
      },
    };
  }

  // Committed line
  let parent: string | undefined;
  let parentAuthor = 'Unknown';
  let parentDate: Date | null = null;
  let parentSummary = '';

  const cachedParent = parentInfoCache.get(hash);
  if (cachedParent !== undefined) {
    if (cachedParent) {
      parent = cachedParent.hash;
      parentAuthor = cachedParent.author;
      parentDate = cachedParent.date;
      parentSummary = cachedParent.summary;
    }
  } else {
    try {
      const stdout = (await exec('git', ['show', '-s', '--format=%P', hash], { cwd: root })).stdout.trim();
      const parents = stdout.split(/\s+/).filter(Boolean);
      parent = parents[0];
      if (parent) {
        const parentFields = (await exec('git', ['show', '-s', '--format=%an%x00%aI%x00%s', parent], { cwd: root })).stdout.split('\0');
        parentAuthor = parentFields[0] || 'Unknown';
        parentDate = parentFields[1] ? new Date(parentFields[1]) : null;
        parentSummary = parentFields[2] || '';
        setCacheWithLimit(parentInfoCache, hash, { hash: parent, author: parentAuthor, date: parentDate, summary: parentSummary });
      } else {
        setCacheWithLimit(parentInfoCache, hash, null);
      }
    } catch {
      setCacheWithLimit(parentInfoCache, hash, null);
    }
  }

  if (!parent) {
    return { hash, origin, author, date, summary, isUncommitted };
  }

  let parentLine = '(file did not exist)';
  try {
    const parentLines = (await exec('git', ['show', `${parent}:${relative}`], { cwd: root })).stdout.split(/\r?\n/);
    const origLineStr = firstLine.split(' ')[1];
    const origLine = origLineStr ? parseInt(origLineStr, 10) - 1 : line;
    parentLine = parentLines[origLine] ?? parentLines[line] ?? '(line did not exist)';
  } catch {}

  return {
    hash,
    origin,
    author,
    date,
    summary,
    isUncommitted,
    parent: {
      hash: parent,
      author: parentAuthor,
      date: parentDate,
      summary: parentSummary,
      line: parentLine,
    },
  };
}
