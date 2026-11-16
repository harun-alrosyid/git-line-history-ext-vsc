const assert = require('node:assert/strict');
const { commitUrl, diffLines } = require('./out/format');
const { parseBlame } = require('./out/git');

const result = parseBlame('author Ada Lovelace\nauthor-time 1700000000\nsummary Fix parser\n');
assert.deepEqual(result, {
  author: 'Ada Lovelace',
  'author-time': '1700000000',
  summary: 'Fix parser'
});
assert.equal(diffLines('const old = true;', 'const current = true;'), '- const old = true;\n+ const current = true;');
assert.equal(commitUrl('git@github.com:org/repo.git', 'abc123'), 'https://github.com/org/repo/commit/abc123');
assert.equal(commitUrl('https://gitlab.com/org/repo.git', 'abc123'), 'https://gitlab.com/org/repo/commit/abc123');
console.log('ok');
