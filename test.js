const assert = require('node:assert/strict');
const path = require('node:path');
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

  // 7. lineCommit on committed file
  const committedFile = path.resolve('package.json');
  const committed = await lineCommit(committedFile, 0);
  assert.ok(committed, 'Expected committed lineCommit to return a result');
  assert.equal(committed.isUncommitted, false);
  assert.ok(committed.hash.length > 0);
  assert.ok(committed.author.length > 0);

  // 8. lineCommit on uncommitted line in .gitignore (line 5 has .docs)
  const uncommittedFile = path.resolve('.gitignore');
  const uncommitted = await lineCommit(uncommittedFile, 4);
  assert.ok(uncommitted, 'Expected uncommitted lineCommit to return a result');
  assert.equal(uncommitted.isUncommitted, true);
  assert.equal(uncommitted.author, 'You');
  assert.equal(uncommitted.summary, 'Uncommitted changes');

  // 9. lineCommit with includeParent: true on uncommitted line
  const uncommittedWithParent = await lineCommit(uncommittedFile, 4, { includeParent: true });
  assert.ok(uncommittedWithParent.parent, 'Expected parent for uncommitted change');
  assert.ok(uncommittedWithParent.parent.hash.length > 0);

  console.log('all tests passed ok');
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
