const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commitUrl, diffLines, escapeMarkdown, html, formatDate, formatTimeAgo } = require('./out/format');
const { parseBlame, lineCommit, clearGitCache } = require('./out/git');

async function runTests() {
  // 1. parseBlame basic
  const basicBlame = parseBlame('author Ada Lovelace\nauthor-time 1700000000\nsummary Fix parser\n');
  assert.deepEqual(basicBlame, {
    author: 'Ada Lovelace',
    'author-time': '1700000000',
    summary: 'Fix parser'
  });

  // 2. parseBlame does not get polluted by source code lines starting with \t
  const porcelainWithCode = [
    '7e658a2101533542aca969419524337db2463a97 1 1 1',
    'author Ada Lovelace',
    'summary Important fix',
    'filename src/main.ts',
    '\tauthor = "should not overwrite author";'
  ].join('\n');
  const parsedWithCode = parseBlame(porcelainWithCode);
  assert.equal(parsedWithCode.author, 'Ada Lovelace');
  assert.equal(parsedWithCode.summary, 'Important fix');

  // 3. diffLines
  assert.equal(diffLines('const old = true;', 'const current = true;'), '- const old = true;\n+ const current = true;');

  // 4. commitUrl provider patterns
  assert.equal(commitUrl('git@github.com:org/repo.git', 'abc123'), 'https://github.com/org/repo/commit/abc123');
  assert.equal(commitUrl('https://github.com/org/repo.git', 'abc123'), 'https://github.com/org/repo/commit/abc123');
  assert.equal(commitUrl('git@gitlab.com:org/repo.git', 'abc123'), 'https://gitlab.com/org/repo/-/commit/abc123');
  assert.equal(commitUrl('https://gitlab.com/org/repo.git', 'abc123'), 'https://gitlab.com/org/repo/-/commit/abc123');
  assert.equal(commitUrl('git@bitbucket.org:org/repo.git', 'abc123'), 'https://bitbucket.org/org/repo/commits/abc123');
  assert.equal(commitUrl('https://bitbucket.org/org/repo.git', 'abc123'), 'https://bitbucket.org/org/repo/commits/abc123');
  assert.equal(commitUrl('ssh://git@github.com:22/org/repo.git', 'abc123'), 'https://github.com/org/repo/commit/abc123');

  // 5. commitUrl edge cases
  assert.equal(commitUrl('git@github.com:org/repo.git', '0000000000000000000000000000000000000000'), null);
  assert.equal(commitUrl(null, 'abc123'), null);
  assert.equal(commitUrl('', 'abc123'), null);

  // 6. escapeMarkdown and html
  assert.equal(escapeMarkdown('hello [world] (test) *bold*'), 'hello \\[world\\] \\(test\\) \\*bold\\*');
  assert.equal(html('Tom & Jerry <script>"quotes"\''), 'Tom &amp; Jerry &lt;script&gt;&quot;quotes&quot;&#39;');

  // 7. Relative Time formatting (3.2)
  const now = new Date('2026-11-18T10:00:00Z');
  assert.equal(formatTimeAgo(null), 'Unknown date');
  assert.equal(formatTimeAgo(new Date('invalid')), 'Unknown date');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 20 * 1000), 'en', now), 'just now');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 5 * 60 * 1000), 'en', now), '5 minutes ago');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 3 * 3600 * 1000), 'en', now), '3 hours ago');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 4 * 86400 * 1000), 'en', now), '4 days ago');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 60 * 86400 * 1000), 'en', now), '2 months ago');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 400 * 86400 * 1000), 'en', now), 'last year');
  assert.equal(formatTimeAgo(new Date(now.getTime() - 800 * 86400 * 1000), 'en', now), '2 years ago');

  // formatDate styles
  const testDate = new Date('2026-05-10T12:00:00Z');
  assert.equal(formatDate(testDate, 'relative', 'en'), formatTimeAgo(testDate, 'en'));
  assert.ok(formatDate(testDate, 'date', 'en').length > 0);
  assert.ok(formatDate(testDate, 'datetime', 'en').length > 0);

  // 8. lineCommit testing using isolated temp git repo (3.1 caching & git integration)
  clearGitCache();
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-line-history-test-'));
  const tempDir = fs.realpathSync(rawDir);
  try {
    execFileSync('git', ['init'], { cwd: tempDir });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
    execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: tempDir });
    const tempFile = path.join(tempDir, 'demo.txt');
    fs.writeFileSync(tempFile, 'first committed line\n');
    execFileSync('git', ['add', 'demo.txt'], { cwd: tempDir });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: tempDir });
    fs.appendFileSync(tempFile, 'second uncommitted line\n');

    // Test committed line
    const committed = await lineCommit(tempFile, 0);
    assert.ok(committed, 'Expected committed lineCommit to return a result');
    assert.equal(committed.isUncommitted, false);
    assert.equal(committed.author, 'Tester');
    assert.equal(committed.summary, 'initial commit');

    // Test hierarchical cache: call lineCommit on a nested file in a subfolder
    const subDir = path.join(tempDir, 'nested', 'deep');
    fs.mkdirSync(subDir, { recursive: true });
    const subFile = path.join(subDir, 'nested.txt');
    fs.writeFileSync(subFile, 'nested file\n');
    execFileSync('git', ['add', 'nested/deep/nested.txt'], { cwd: tempDir });
    execFileSync('git', ['commit', '-m', 'nested commit'], { cwd: tempDir });
    const nestedResult = await lineCommit(subFile, 0);
    assert.ok(nestedResult, 'Expected nested lineCommit to return a result from cache');
    assert.equal(nestedResult.summary, 'nested commit');

    // Test uncommitted line
    const uncommitted = await lineCommit(tempFile, 1);
    assert.ok(uncommitted, 'Expected uncommitted lineCommit to return a result');
    assert.equal(uncommitted.isUncommitted, true);
    assert.equal(uncommitted.author, 'You');
    assert.equal(uncommitted.summary, 'Uncommitted changes');

    // Test uncommitted with includeParent
    const uncommittedWithParent = await lineCommit(tempFile, 1, { includeParent: true });
    assert.ok(uncommittedWithParent.parent, 'Expected parent for uncommitted change');
    assert.equal(uncommittedWithParent.parent.hash.length, 40);

    // Test 3.4: Dirty buffer (unsaved file) via options.contents
    const dirtyBuffer = 'inserted line 1\ninserted line 2\nfirst committed line\n';
    // Line 0: new unsaved line
    const dirtyLine0 = await lineCommit(tempFile, 0, { contents: dirtyBuffer });
    assert.ok(dirtyLine0, 'Expected dirty line 0 to return a result');
    assert.equal(dirtyLine0.isUncommitted, true);
    assert.equal(dirtyLine0.author, 'You');

    // Line 2: original first committed line shifted down by 2 lines in dirty buffer
    const dirtyLine2 = await lineCommit(tempFile, 2, { contents: dirtyBuffer });
    assert.ok(dirtyLine2, 'Expected shifted committed line to return a result');
    assert.equal(dirtyLine2.isUncommitted, false);
    assert.equal(dirtyLine2.hash, committed.hash);
    assert.equal(dirtyLine2.summary, 'initial commit');
  } finally {
    clearGitCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('all tests passed ok');
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
