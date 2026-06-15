const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const indexPath = path.resolve(__dirname, '../index.js');
const source = fs.readFileSync(indexPath, 'utf8');
const localRequire = createRequire(indexPath);
const wtbu = localRequire('./schools/wtbu');
const { getSchool } = localRequire('./schools');
const parseGrades = wtbu.__test__.parseGrades;
const parseExams = wtbu.__test__.parseExams;
const fetchExams = wtbu.__test__.fetchExams;
const findExamBatches = wtbu.__test__.findExamBatches;
const getExamBatchPaths = wtbu.__test__.getExamBatchPaths;
const mergeExams = wtbu.__test__.mergeExams;
const setExamBatchFetchDelayMs = wtbu.__test__.setExamBatchFetchDelayMs;

process.env.EDU_PASSWORD_SECRET = 'a'.repeat(64);

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
          return context.fakeDb || {};
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
    parseGrades(html, '\u0032\u0030\u0032\u0035-\u0032\u0030\u0032\u0036\u5b66\u5e74\u7b2c\u4e8c\u5b66\u671f')
  ));
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function getFirstGrade(result) {
  assert.strictEqual(result.semesters.length, 1);
  assert.strictEqual(result.semesters[0].grades.length, 1);
  return result.semesters[0].grades[0];
}

function getSummaryValue(result, label) {
  const item = result.summary.find((summaryItem) => summaryItem.label === label);

  return item ? item.value : '';
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

const weightedAverage = parse(`
<table>
  <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u5b66\u5206</th><th>\u6210\u7ee9</th><th>\u7ee9\u70b9</th></tr>
  <tr><td>\u4f53\u80b2</td><td>1</td><td>100</td><td>5</td></tr>
  <tr><td>\u4e13\u4e1a\u8bfe</td><td>4</td><td>85</td><td>3.5</td></tr>
</table>`);

assert.strictEqual(getSummaryValue(weightedAverage, '\u5e73\u5747\u5206'), '88');
assert.strictEqual(weightedAverage.semesters[0].average, '88');

const orderedSemesters = parse(`
<table>
  <tr><th>\u5b66\u5e74\u5b66\u671f</th><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u5b66\u5206</th><th>\u6210\u7ee9</th><th>\u7ee9\u70b9</th></tr>
  <tr><td>2024-2025\u5b66\u5e74\u7b2c\u4e00\u5b66\u671f</td><td>\u79bb\u6563\u6570\u5b66</td><td>4</td><td>90</td><td>4.0</td></tr>
  <tr><td>2025-2026\u5b66\u5e74\u7b2c\u4e8c\u5b66\u671f</td><td>\u7ebf\u6027\u4ee3\u6570</td><td>4</td><td>95</td><td>4.5</td></tr>
</table>`);

assert.strictEqual(orderedSemesters.semesters[0].title, '2025-2026\u5b66\u5e74\u7b2c\u4e8c\u5b66\u671f');

const arrangedExams = parseExams(`
<table>
  <tr><th>课程序号</th><th>课程名称</th><th>考试类别</th><th>考试日期</th><th>考试安排</th><th>考试地点</th><th>考场座位号</th><th>考试情况</th></tr>
  <tr><td>01311004.31</td><td>大学英语（4）</td><td>期末考试</td><td>2026-07-03</td><td>13:10~14:50</td><td>弘德楼（原综合楼）608</td><td>8</td><td>正常</td></tr>
  <tr><td>09334003.02</td><td>解剖与透视</td><td>期末考试</td><td>时间未安排</td><td>时间未安排</td><td>地点未安排</td><td>地点未安排</td><td>正常</td></tr>
  <tr><td>12311004.20</td><td>毛泽东思想和中国特色社会主义理论体系概论</td><td>期末考试</td><td>2026-07-03</td><td>10:30~12:10</td><td>弘德楼（原综合楼）308</td><td>70</td><td>正常</td></tr>
</table>`, {
  id: '1428',
  name: '第二批期末考试（17-19周）'
});

assert.deepStrictEqual(arrangedExams.map((exam) => ({
  batchId: exam.batchId,
  batchName: exam.batchName,
  name: exam.name,
  date: exam.date,
  time: exam.time,
  location: exam.location,
  seat: exam.seat,
  status: exam.status
})), [
  {
    batchId: '1428',
    batchName: '第二批期末考试（17-19周）',
    name: '大学英语（4）',
    date: '2026-07-03',
    time: '13:10~14:50',
    location: '弘德楼（原综合楼）608',
    seat: '8',
    status: '正常'
  },
  {
    batchId: '1428',
    batchName: '第二批期末考试（17-19周）',
    name: '解剖与透视',
    date: '',
    time: '',
    location: '',
    seat: '',
    status: '未安排'
  },
  {
    batchId: '1428',
    batchName: '第二批期末考试（17-19周）',
    name: '毛泽东思想和中国特色社会主义理论体系概论',
    date: '2026-07-03',
    time: '10:30~12:10',
    location: '弘德楼（原综合楼）308',
    seat: '70',
    status: '正常'
  }
]);

const examBatches = findExamBatches(`
<select name="examBatch.id">
  <option value="1428">第二批期末考试（17-19周）</option>
  <option value="1412" selected>第一批期末考试（13-14周）</option>
</select>`);

assert.deepStrictEqual(examBatches.map((batch) => ({
  id: batch.id,
  name: batch.name,
  selected: batch.selected
})), [
  { id: '1428', name: '第二批期末考试（17-19周）', selected: false },
  { id: '1412', name: '第一批期末考试（13-14周）', selected: true }
]);
assert.strictEqual(mergeExams([arrangedExams, arrangedExams]).length, arrangedExams.length);

assert.deepStrictEqual(getExamBatchPaths({ id: '1428' }), [
  '/eams/stdExamTable!examTable.action?examBatch.id=1428',
  '/eams/stdExamTable.action?examBatch.id=1428',
  '/eams/examTableForStd.action?examBatch.id=1428'
]);

const firstBatchExam = parseExams(`
<table>
  <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u8003\u8bd5\u65e5\u671f</th><th>\u8003\u8bd5\u5b89\u6392</th><th>\u8003\u8bd5\u5730\u70b9</th><th>\u8003\u573a\u5ea7\u4f4d\u53f7</th><th>\u8003\u8bd5\u60c5\u51b5</th></tr>
  <tr><td>\u5927\u5b66\u82f1\u8bed\uff084\uff09</td><td>2026-07-03</td><td>13:10~14:50</td><td>\u5f18\u5fb7\u697c608</td><td>8</td><td>\u6b63\u5e38</td></tr>
</table>`, {
  id: '1412',
  name: '\u7b2c\u4e00\u6279\u671f\u672b\u8003\u8bd5\uff0813-14\u5468\uff09'
});

const secondBatchExam = parseExams(`
<table>
  <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u8003\u8bd5\u65e5\u671f</th><th>\u8003\u8bd5\u5b89\u6392</th><th>\u8003\u8bd5\u5730\u70b9</th><th>\u8003\u573a\u5ea7\u4f4d\u53f7</th><th>\u8003\u8bd5\u60c5\u51b5</th></tr>
  <tr><td>\u5927\u5b66\u82f1\u8bed\uff084\uff09</td><td>2026-07-03</td><td>13:10~14:50</td><td>\u5f18\u5fb7\u697c608</td><td>8</td><td>\u6b63\u5e38</td></tr>
</table>`, {
  id: '1428',
  name: '\u7b2c\u4e8c\u6279\u671f\u672b\u8003\u8bd5\uff0817-19\u5468\uff09'
});

const sameCourseDifferentBatches = mergeExams([firstBatchExam, secondBatchExam]);
assert.strictEqual(sameCourseDifferentBatches.length, 2);
assert.deepStrictEqual(
  sameCourseDifferentBatches.map((exam) => exam.batchId),
  ['1412', '1428']
);

async function runFetchExamBatchTests() {
  const defaultHtml = `
  <select name="examBatch.id">
    <option value="1428" selected>\u7b2c\u4e8c\u6279\u671f\u672b\u8003\u8bd5\uff0817-19\u5468\uff09</option>
    <option value="1427">\u7b2c\u4e00\u6279\u671f\u672b\u8003\u8bd5\uff0813-14\u5468\uff09</option>
  </select>
  <table>
    <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u8003\u8bd5\u65e5\u671f</th><th>\u8003\u8bd5\u5b89\u6392</th><th>\u8003\u8bd5\u5730\u70b9</th><th>\u8003\u573a\u5ea7\u4f4d\u53f7</th><th>\u8003\u8bd5\u60c5\u51b5</th></tr>
    <tr><td>\u5927\u5b66\u82f1\u8bed\uff084\uff09</td><td>2026-07-03</td><td>13:10~14:50</td><td>\u5f18\u5fb7\u697c608</td><td>8</td><td>\u6b63\u5e38</td></tr>
  </table>`;
  const firstBatchHtml = `
  <table>
    <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u8003\u8bd5\u65e5\u671f</th><th>\u8003\u8bd5\u5b89\u6392</th><th>\u8003\u8bd5\u5730\u70b9</th><th>\u8003\u573a\u5ea7\u4f4d\u53f7</th><th>\u8003\u8bd5\u60c5\u51b5</th></tr>
    <tr><td>\u6bdb\u6982</td><td>2026-06-18</td><td>10:30~12:10</td><td>\u5f18\u5fb7\u697c308</td><td>70</td><td>\u6b63\u5e38</td></tr>
  </table>`;
  const requestedPaths = [];
  const requestCounts = new Map();
  const client = {
    get(path) {
      requestedPaths.push(path);
      requestCounts.set(path, (requestCounts.get(path) || 0) + 1);

      if (path === '/eams/stdExamTable.action') {
        return Promise.resolve({ data: defaultHtml });
      }

      if (path === '/eams/stdExamTable!examTable.action?examBatch.id=1427') {
        if (requestCounts.get(path) === 1) {
          return Promise.resolve({ data: '\u8bf7\u4e0d\u8981\u8fc7\u5feb\u70b9\u51fb' });
        }

        return Promise.resolve({ data: firstBatchHtml });
      }

      return Promise.resolve({ data: '' });
    }
  };

  setExamBatchFetchDelayMs(0);

  let exams;

  try {
    exams = await fetchExams(client, '');
  } finally {
    setExamBatchFetchDelayMs(1600);
  }

  assert.deepStrictEqual(exams.map((exam) => ({
    batchId: exam.batchId,
    name: exam.name
  })), [
    { batchId: '1428', name: '\u5927\u5b66\u82f1\u8bed\uff084\uff09' },
    { batchId: '1427', name: '\u6bdb\u6982' }
  ]);
  assert.strictEqual(
    requestedPaths.includes('/eams/stdExamTable!examTable.action?examBatch.id=1428'),
    false
  );
  assert.strictEqual(requestCounts.get('/eams/stdExamTable!examTable.action?examBatch.id=1427'), 2);

  const emptyCurrentHtml = `
  <select name="examBatch.id">
    <option value="1428" selected>\u7b2c\u4e8c\u6279\u671f\u672b\u8003\u8bd5\uff0817-19\u5468\uff09</option>
    <option value="1427">\u7b2c\u4e00\u6279\u671f\u672b\u8003\u8bd5\uff0813-14\u5468\uff09</option>
  </select>`;
  const secondBatchHtml = `
  <table>
    <tr><th>\u8bfe\u7a0b\u540d\u79f0</th><th>\u8003\u8bd5\u65e5\u671f</th><th>\u8003\u8bd5\u5b89\u6392</th><th>\u8003\u8bd5\u5730\u70b9</th><th>\u8003\u573a\u5ea7\u4f4d\u53f7</th><th>\u8003\u8bd5\u60c5\u51b5</th></tr>
    <tr><td>\u9ad8\u7b49\u6570\u5b66</td><td>2026-07-04</td><td>08:30~10:10</td><td>\u5f18\u5fb7\u697c408</td><td>18</td><td>\u6b63\u5e38</td></tr>
  </table>`;
  const fallbackRequests = [];
  const fallbackClient = {
    get(path) {
      fallbackRequests.push(path);

      if (path === '/eams/stdExamTable.action') {
        return Promise.resolve({ data: emptyCurrentHtml });
      }

      if (path === '/eams/stdExamTable!examTable.action?examBatch.id=1428') {
        return Promise.resolve({ data: secondBatchHtml });
      }

      if (path === '/eams/stdExamTable!examTable.action?examBatch.id=1427') {
        return Promise.resolve({ data: firstBatchHtml });
      }

      return Promise.resolve({ data: '' });
    }
  };

  setExamBatchFetchDelayMs(0);

  try {
    exams = await fetchExams(fallbackClient, '');
  } finally {
    setExamBatchFetchDelayMs(1600);
  }

  assert.deepStrictEqual(exams.map((exam) => ({
    batchId: exam.batchId,
    name: exam.name
  })), [
    { batchId: '1428', name: '\u9ad8\u7b49\u6570\u5b66' },
    { batchId: '1427', name: '\u6bdb\u6982' }
  ]);
  assert.ok(fallbackRequests.includes('/eams/stdExamTable!examTable.action?examBatch.id=1428'));
}

function createSchedule(id) {
  return {
    term: `term-${id}`,
    selectedSemesterId: id,
    courses: [{ id: `course-${id}`, weekday: 1, sections: [1] }],
    semesters: [{ id, label: `学期 ${id}` }]
  };
}

function createGrades(id) {
  return {
    summary: [{ label: '总学分', value: id }],
    semesters: [{ id, title: `成绩 ${id}`, grades: [] }]
  };
}

function createCachedGrades(id) {
  return Object.assign(createGrades(id), {
    cacheVersion: 2
  });
}

function createBinding(overrides = {}) {
  return Object.assign({
    studentId: '20260001',
    passwordCipher: context.encryptPassword('pw'),
    lastSchedule: createSchedule('current'),
    lastExams: [{ id: 'exam-current' }],
    lastGrades: createCachedGrades('current'),
    lastFetchedAt: new Date().toISOString(),
    cacheVersion: 2,
    scheduleCaches: {}
  }, overrides);
}

function useFakeDb(binding) {
  const state = {
    binding,
    updates: [],
    sets: []
  };

  context.fakeDb = {
    command: {
      set(value) {
        return { __set: value };
      }
    },
    serverDate() {
      return 'SERVER_DATE';
    },
    collection(name) {
      return {
        doc(id) {
          return {
            get() {
              return Promise.resolve({ data: state.binding });
            },
            update(options) {
              state.updates.push({ name, id, options });
              return Promise.resolve();
            },
            set(options) {
              state.sets.push({ name, id, options });
              return Promise.resolve();
            }
          };
        }
      };
    }
  };

  return state;
}

async function runCacheTests() {
  await runFetchExamBatchTests();

  const schoolsResult = await context.exports.main({ action: 'schools' });

  assert.strictEqual(schoolsResult.success, true);
  assert.strictEqual(schoolsResult.data.defaultSchoolId, 'wtbu');
  assert.strictEqual(schoolsResult.data.schools[0].id, 'wtbu');
  assert.strictEqual(schoolsResult.data.schools[0].name, '武汉工商学院');
  assert.strictEqual(typeof getSchool('wtbu').adapter.fetchAllByCredentials, 'function');

  let capturedUpdate = null;
  const cachedGrades = { summary: [], semesters: [] };

  context.fakeDb = {
    command: {
      set(value) {
        return { __set: value };
      }
    },
    serverDate() {
      return 'SERVER_DATE';
    },
    collection(name) {
      return {
        doc(id) {
          return {
            update(options) {
              capturedUpdate = { name, id, options };
              return Promise.resolve();
            }
          };
        }
      };
    }
  };

  await context.updateGradesCache('openid-1', cachedGrades);
  assert.strictEqual(capturedUpdate.name, 'eduAccountBindings');
  assert.strictEqual(capturedUpdate.id, 'openid-1');
  assert.deepStrictEqual(toPlain(capturedUpdate.options.data.lastGrades), {
    __set: Object.assign({}, cachedGrades, { cacheVersion: 2 })
  });
  assert.strictEqual(capturedUpdate.options.data.updatedAt, 'SERVER_DATE');

  let fetchAllCalls = 0;
  const freshBinding = createBinding();
  useFakeDb(freshBinding);
  context.fetchAllByCredentials = async () => {
    fetchAllCalls += 1;
    throw new Error('fresh cache should not fetch edu system');
  };
  const freshSchedule = await context.getBoundSchedule();
  const freshGrades = await context.getBoundGrades();

  assert.strictEqual(fetchAllCalls, 0);
  assert.strictEqual(freshSchedule.data.term, freshBinding.lastSchedule.term);
  assert.deepStrictEqual(freshSchedule.data.exams, freshBinding.lastExams);
  assert.deepStrictEqual(toPlain(freshGrades.data), freshBinding.lastGrades);

  const legacyVersionBinding = createBinding({ cacheVersion: 1 });
  useFakeDb(legacyVersionBinding);
  let legacyVersionFetchCalls = 0;
  context.fetchAllByCredentials = async () => {
    legacyVersionFetchCalls += 1;
    return {
      schedule: createSchedule('legacy-version'),
      exams: [{ id: 'exam-legacy-version' }],
      grades: createGrades('legacy-version'),
      profile: null
    };
  };
  const legacyVersionSchedule = await context.getBoundSchedule();

  assert.strictEqual(legacyVersionFetchCalls, 1);
  assert.strictEqual(legacyVersionSchedule.data.term, 'term-legacy-version');

  fetchAllCalls = 0;
  context.fetchAllByCredentials = async () => {
    fetchAllCalls += 1;
    return {
      schedule: createSchedule('forced'),
      exams: [{ id: 'exam-forced' }],
      grades: createGrades('forced'),
      profile: null
    };
  };
  const forcedSchedule = await context.getBoundSchedule({ force: true });
  const forcedGrades = await context.getBoundGrades({ force: true });

  assert.strictEqual(fetchAllCalls, 2);
  assert.strictEqual(forcedSchedule.data.term, 'term-forced');
  assert.deepStrictEqual(toPlain(forcedGrades.data), createCachedGrades('forced'));

  const expiredBinding = createBinding({
    lastFetchedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
  });
  const expiredState = useFakeDb(expiredBinding);
  context.fetchAllByCredentials = async (studentId, password, options) => {
    fetchAllCalls += 1;
    assert.strictEqual(studentId, expiredBinding.studentId);
    assert.strictEqual(password, 'pw');
    assert.strictEqual(options.schoolId, 'wtbu');
    return {
      schedule: createSchedule('refreshed'),
      exams: [{ id: 'exam-refreshed' }],
      grades: createGrades('refreshed'),
      profile: null
    };
  };
  fetchAllCalls = 0;
  const expiredSchedule = await context.getBoundSchedule();

  assert.strictEqual(fetchAllCalls, 1);
  assert.strictEqual(expiredSchedule.data.term, 'term-refreshed');
  assert.strictEqual(expiredState.updates.length, 1);
  assert.deepStrictEqual(toPlain(expiredState.updates[0].options.data.lastGrades), { __set: createCachedGrades('refreshed') });
  assert.strictEqual(expiredState.updates[0].options.data.schoolId, 'wtbu');
  assert.strictEqual(expiredState.updates[0].options.data.schoolName, '武汉工商学院');
  assert.ok(expiredState.updates[0].options.data.lastFetchedAt);
  assert.ok(expiredState.updates[0].options.data.scheduleCaches.__set.current);

  const legacyBinding = createBinding();
  delete legacyBinding.scheduleCaches;
  const legacyState = useFakeDb(legacyBinding);
  fetchAllCalls = 0;
  context.fetchAllByCredentials = async () => {
    fetchAllCalls += 1;
    return {
      schedule: createSchedule('legacy-refreshed'),
      exams: [{ id: 'exam-legacy-refreshed' }],
      grades: createGrades('legacy-refreshed'),
      profile: null
    };
  };
  const legacySchedule = await context.getBoundSchedule();

  assert.strictEqual(fetchAllCalls, 1);
  assert.strictEqual(legacySchedule.data.term, 'term-legacy-refreshed');
  assert.ok(legacyState.updates[0].options.data.scheduleCaches.__set.current);

  const manualBinding = createBinding();
  const manualState = useFakeDb(manualBinding);
  fetchAllCalls = 0;
  context.fetchAllByCredentials = async () => {
    fetchAllCalls += 1;
    return {
      schedule: createSchedule('manual'),
      exams: [{ id: 'exam-manual' }],
      grades: createGrades('manual'),
      profile: null
    };
  };
  const manualResult = await context.exports.main({ action: 'refreshAll' });

  assert.strictEqual(manualResult.success, true);
  assert.strictEqual(fetchAllCalls, 1);
  assert.strictEqual(manualResult.data.schedule.term, 'term-manual');
  assert.deepStrictEqual(toPlain(manualResult.data.grades), createCachedGrades('manual'));
  assert.ok(manualResult.data.refreshedAt);
  assert.strictEqual(manualState.updates.length, 1);

  const semesterBinding = createBinding({
    scheduleCaches: {
      2024: {
        schedule: createSchedule('2024'),
        exams: [{ id: 'exam-2024' }],
        cacheVersion: 2,
        fetchedAt: new Date().toISOString()
      }
    }
  });
  useFakeDb(semesterBinding);
  let semesterFetchCalls = 0;
  context.fetchScheduleByCredentials = async () => {
    semesterFetchCalls += 1;
    throw new Error('cached semester should not fetch edu system');
  };
  const cachedSemester = await context.getBoundSchedule({ semesterId: '2024' });

  assert.strictEqual(semesterFetchCalls, 0);
  assert.strictEqual(cachedSemester.data.term, 'term-2024');

  const missingSemesterState = useFakeDb(createBinding());
  context.fetchScheduleByCredentials = async (studentId, password, options) => {
    semesterFetchCalls += 1;
    assert.strictEqual(password, 'pw');
    assert.strictEqual(options.semesterId, '2023');
    return {
      schedule: createSchedule('2023'),
      exams: [{ id: 'exam-2023' }]
    };
  };
  semesterFetchCalls = 0;
  const missingSemester = await context.getBoundSchedule({ semesterId: '2023' });

  assert.strictEqual(semesterFetchCalls, 1);
  assert.strictEqual(missingSemester.data.term, 'term-2023');
  assert.strictEqual(missingSemesterState.updates.length, 1);
  assert.ok(missingSemesterState.updates[0].options.data.scheduleCaches.__set['2023']);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(missingSemesterState.updates[0].options.data, 'lastSchedule'),
    false
  );

  const expiredSemesterBinding = createBinding({
    lastFetchedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
  });
  useFakeDb(expiredSemesterBinding);
  let expiredFetchAllCalls = 0;
  let expiredSemesterCalls = 0;

  context.fetchAllByCredentials = async () => {
    expiredFetchAllCalls += 1;
    return {
      schedule: createSchedule('current-refreshed'),
      exams: [{ id: 'exam-current-refreshed' }],
      grades: createGrades('current-refreshed'),
      profile: null
    };
  };
  context.fetchScheduleByCredentials = async (studentId, password, options) => {
    expiredSemesterCalls += 1;
    assert.strictEqual(options.semesterId, '2022');
    return {
      schedule: createSchedule('2022'),
      exams: [{ id: 'exam-2022' }]
    };
  };

  const expiredSemester = await context.getBoundSchedule({ semesterId: '2022' });

  assert.strictEqual(expiredFetchAllCalls, 1);
  assert.strictEqual(expiredSemesterCalls, 1);
  assert.strictEqual(expiredSemester.data.term, 'term-2022');

  const bindState = useFakeDb(null);
  const school = getSchool('wtbu');
  const originalFetchAll = school.adapter.fetchAllByCredentials;
  school.adapter.fetchAllByCredentials = async (studentId, password, options) => {
    assert.strictEqual(studentId, '20260002');
    assert.strictEqual(password, 'bind-pw');
    assert.strictEqual(options.schoolId, 'wtbu');
    return {
      schedule: createSchedule('bind'),
      exams: [{ id: 'exam-bind' }],
      grades: createGrades('bind'),
      profile: { studentId: '20260002', name: '测试学生' }
    };
  };

  let bindResult;

  try {
    bindResult = await context.exports.main({
      action: 'bind',
      schoolId: 'wtbu',
      studentId: '20260002',
      password: 'bind-pw'
    });
  } finally {
    school.adapter.fetchAllByCredentials = originalFetchAll;
  }

  assert.strictEqual(bindResult.success, true);
  assert.strictEqual(bindResult.data.school.id, 'wtbu');
  assert.strictEqual(bindState.sets.length, 1);
  assert.strictEqual(bindState.sets[0].options.data.schoolId, 'wtbu');
  assert.strictEqual(bindState.sets[0].options.data.schoolName, '武汉工商学院');

  const unsupportedResult = await context.exports.main({
    action: 'direct',
    schoolId: 'unknown-school',
    studentId: '20260003',
    password: 'pw'
  });

  assert.strictEqual(unsupportedResult.success, false);
  assert.strictEqual(unsupportedResult.code, 'SCHOOL_NOT_SUPPORTED');
}

runCacheTests()
  .then(() => {
    console.log('grade parser and cache tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
