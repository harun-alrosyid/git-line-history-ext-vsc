const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { commitUrl, diffLines, escapeMarkdown, html } = require('./out/format');
const { parseBlame, lineCommit } = require('./out/git');

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

  // 7. lineCommit testing using isolated temp git repo
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

    // Test uncommitted line
    const uncommitted = await lineCommit(tempFile, 1);
    assert.ok(uncommitted, 'Expected uncommitted lineCommit to return a result');
    assert.equal(uncommitted.isUncommitted, true);
    assert.equal(uncommitted.author, 'You');
    assert.equal(uncommitted.summary, 'Uncommitted changes');

    // Test uncommitted with includeParent
    const uncommittedWithParent = await lineCommit(tempFile, 1, { includeParent: true });
    assert.ok(uncommittedWithParent.parent, 'Expected parent for uncommitted change');
    assert.equal(uncommittedWithParent.parent.hash, committed.hash);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('all tests passed ok');
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
