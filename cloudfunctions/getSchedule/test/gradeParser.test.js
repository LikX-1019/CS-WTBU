const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const indexPath = path.resolve(__dirname, '../index.js');
const source = fs.readFileSync(indexPath, 'utf8');
const localRequire = createRequire(indexPath);
const context = {
  Buffer,
  URL,
  URLSearchParams,
  console,
  exports: {},
  module: { exports: {} },
  process,
  require(name) {
    if (name === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        database() {
          return {};
        },
        getWXContext() {
          return { OPENID: 'test-openid' };
        },
        init() {}
      };
    }

    return localRequire(name);
  }
};

context.global = context;
vm.runInNewContext(source, context, { filename: indexPath });

function parse(html) {
  return JSON.parse(JSON.stringify(
    context.parseGrades(html, '\u0032\u0030\u0032\u0035-\u0032\u0030\u0032\u0036\u5b66\u5e74\u7b2c\u4e8c\u5b66\u671f')
  ));
}

function getFirstGrade(result) {
  assert.strictEqual(result.semesters.length, 1);
  assert.strictEqual(result.semesters[0].grades.length, 1);
  return result.semesters[0].grades[0];
}

const shiftedByEmptyCell = parse(`
<table>
  <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u8003\u6838\u65b9\u5f0f</th><th>\u5b66\u5206</th><th>\u6210\u7ee9</th><th>\u7ee9\u70b9</th></tr>
  <tr><td>\u519b\u4e8b\u8bad\u7ec3</td><td></td><td>2</td><td>82</td><td>3.2</td></tr>
</table>`);

assert.deepStrictEqual(getFirstGrade(shiftedByEmptyCell), {
  name: '\u519b\u4e8b\u8bad\u7ec3',
  credit: '2',
  score: '82',
  scoreLow: false,
  gpa: '3.2'
});

const completeRow = parse(`
<table>
  <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u5b66\u5206</th><th>\u6210\u7ee9</th><th>\u7ee9\u70b9</th></tr>
  <tr><td>\u9ad8\u7b49\u6570\u5b66</td><td>4</td><td>91</td><td>4.1</td></tr>
</table>`);

assert.deepStrictEqual(getFirstGrade(completeRow), {
  name: '\u9ad8\u7b49\u6570\u5b66',
  credit: '4',
  score: '91',
  scoreLow: false,
  gpa: '4.1'
});

console.log('grade parser tests passed');
