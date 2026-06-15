const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const indexPath = path.resolve(__dirname, '../index.js');
const source = fs.readFileSync(indexPath, 'utf8');
const localRequire = createRequire(indexPath);

process.env.EDU_PASSWORD_SECRET = 'a'.repeat(64);
process.env.ADMIN_OPENIDS = 'admin-openid';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createNotFoundError() {
  const error = new Error('document not exist');
  error.code = 'DATABASE_DOCUMENT_NOT_EXIST';
  return error;
}

function createMemoryDb() {
  const collections = new Map();
  let serverDateIndex = 0;

  function getCollection(name) {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }

    return collections.get(name);
  }

  function listDocuments(name) {
    return [...getCollection(name).entries()].map(([id, data]) => ({
      _id: id,
      ...clone(data)
    }));
  }

  function applyFields(doc, fields) {
    if (!fields) {
      return doc;
    }

    const projected = {};

    Object.keys(fields).forEach((key) => {
      if (fields[key] && Object.prototype.hasOwnProperty.call(doc, key)) {
        projected[key] = doc[key];
      }
    });

    return projected;
  }

  function createQuery(name, state = {}) {
    return {
      where(criteria) {
        return createQuery(name, {
          ...state,
          filters: [...(state.filters || []), criteria || {}]
        });
      },
      field(fields) {
        return createQuery(name, {
          ...state,
          fields
        });
      },
      orderBy(field, direction) {
        return createQuery(name, {
          ...state,
          orderField: field,
          orderDirection: direction
        });
      },
      limit(limitValue) {
        return createQuery(name, {
          ...state,
          limitValue: Number(limitValue) || 0
        });
      },
      async count() {
        const result = await this.get();
        return { total: result.data.length };
      },
      async get() {
        let docs = listDocuments(name);

        (state.filters || []).forEach((criteria) => {
          docs = docs.filter((doc) => {
            return Object.keys(criteria).every((key) => doc[key] === criteria[key]);
          });
        });

        if (state.orderField) {
          const factor = state.orderDirection === 'desc' ? -1 : 1;

          docs.sort((left, right) => {
            return String(left[state.orderField] || '').localeCompare(String(right[state.orderField] || '')) * factor;
          });
        }

        if (state.limitValue > 0) {
          docs = docs.slice(0, state.limitValue);
        }

        return {
          data: docs.map((doc) => applyFields(doc, state.fields))
        };
      }
    };
  }

  const db = {
    command: {
      set(value) {
        return { __set: value };
      }
    },
    serverDate() {
      serverDateIndex += 1;
      return `2026-02-01T00:00:${String(serverDateIndex).padStart(2, '0')}.000Z`;
    },
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const collection = getCollection(name);

              if (!collection.has(id)) {
                throw createNotFoundError();
              }

              return {
                data: {
                  _id: id,
                  ...clone(collection.get(id))
                }
              };
            },
            async set(options = {}) {
              getCollection(name).set(id, clone(options.data || {}));
            },
            async update(options = {}) {
              const collection = getCollection(name);

              if (!collection.has(id)) {
                throw createNotFoundError();
              }

              collection.set(id, {
                ...collection.get(id),
                ...clone(options.data || {})
              });
            },
            async remove() {
              getCollection(name).delete(id);
            }
          };
        },
        where(criteria) {
          return createQuery(name).where(criteria);
        },
        field(fields) {
          return createQuery(name).field(fields);
        },
        orderBy(field, direction) {
          return createQuery(name).orderBy(field, direction);
        },
        limit(limitValue) {
          return createQuery(name).limit(limitValue);
        },
        get() {
          return createQuery(name).get();
        },
        count() {
          return createQuery(name).count();
        }
      };
    },
    setDoc(name, id, data) {
      getCollection(name).set(id, clone(data));
    },
    getDoc(name, id) {
      const collection = getCollection(name);
      return collection.has(id) ? clone(collection.get(id)) : null;
    },
    getDocs(name) {
      return listDocuments(name);
    }
  };

  return db;
}

function createContext() {
  const context = {
    Buffer,
    URL,
    URLSearchParams,
    console,
    currentOpenid: 'test-openid',
    fakeDb: createMemoryDb(),
    exports: {},
    module: { exports: {} },
    process,
    require(name) {
      if (name === 'wx-server-sdk') {
        return {
          DYNAMIC_CURRENT_ENV: 'test',
          database() {
            return context.fakeDb;
          },
          getWXContext() {
            return { OPENID: context.currentOpenid };
          },
          init() {}
        };
      }

      return localRequire(name);
    }
  };

  context.global = context;
  vm.runInNewContext(source, context, { filename: indexPath });

  return context;
}

function bindUser(context, openid, schoolId = 'wtbu') {
  context.fakeDb.setDoc('eduAccountBindings', openid, {
    studentId: `student-${openid}`,
    passwordCipher: 'cipher',
    schoolId,
    schoolName: 'Wuhan Business University',
    lastFetchedAt: '2026-02-01T00:00:00.000Z',
    cacheVersion: 3,
    lastSchedule: { courses: [] },
    lastExams: [],
    lastGrades: { summary: [], semesters: [], cacheVersion: 3 },
    scheduleCaches: {}
  });
}

async function callAs(context, openid, event) {
  context.currentOpenid = openid;
  return context.exports.main(event);
}

async function assertInvalidSave(context, event, message) {
  const result = await callAs(context, 'admin-openid', {
    action: 'adminSaveTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: '2025-2026-2',
    term: 'Spring 2026',
    weekNumber: 1,
    weekMondayDate: '2026-02-23',
    ...event
  });

  assert.strictEqual(result.success, false, message);
  assert.strictEqual(result.code, 'INVALID_INPUT', message);
}

async function submitReport(context, openid, weekMondayDate, weekNumber = 1, semesterId = 'aggregate-term') {
  bindUser(context, openid);

  return callAs(context, openid, {
    action: 'submitTermWeekReport',
    schoolId: 'wtbu',
    semesterId,
    term: 'Aggregate Term',
    weekNumber,
    weekMondayDate
  });
}

async function runTermWeekTests() {
  const context = createContext();

  bindUser(context, 'admin-openid');
  await assertInvalidSave(context, { weekMondayDate: '2026-02-24' }, 'reject non-Monday date');
  await assertInvalidSave(context, { weekNumber: 0 }, 'reject low week number');
  await assertInvalidSave(context, { weekNumber: 21 }, 'reject high week number');

  const adminSave = await callAs(context, 'admin-openid', {
    action: 'adminSaveTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: '2025-2026-2',
    term: 'Spring 2026',
    weekNumber: 3,
    weekMondayDate: '2026-03-09'
  });

  assert.strictEqual(adminSave.success, true);
  assert.strictEqual(adminSave.data.config.termStartDate, '2026-02-23');
  assert.strictEqual(adminSave.data.config.source, 'admin');

  bindUser(context, 'locked-user');
  const lockedReport = await callAs(context, 'locked-user', {
    action: 'submitTermWeekReport',
    schoolId: 'wtbu',
    semesterId: '2025-2026-2',
    term: 'Spring 2026',
    weekNumber: 1,
    weekMondayDate: '2026-02-23'
  });

  assert.strictEqual(lockedReport.success, false);
  assert.strictEqual(lockedReport.code, 'TERM_WEEK_LOCKED');

  const aggregateContext = createContext();

  await submitReport(aggregateContext, 'user-1', '2026-02-23', 1);
  const updatedUser = await submitReport(aggregateContext, 'user-1', '2026-03-02', 1);

  assert.strictEqual(updatedUser.success, true);
  assert.strictEqual(updatedUser.data.report.weekMondayDate, '2026-03-02');
  assert.strictEqual(updatedUser.data.progress.reportCount, 1);

  const votes = [
    ['user-2', '2026-02-23'],
    ['user-3', '2026-02-23'],
    ['user-4', '2026-02-23'],
    ['user-5', '2026-03-02'],
    ['user-6', '2026-03-02'],
    ['user-7', '2026-03-02'],
    ['user-8', '2026-03-09'],
    ['user-9', '2026-03-09']
  ];

  for (const [openid, date] of votes) {
    const result = await submitReport(aggregateContext, openid, date, 1);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.config, null);
  }

  const tenthVote = await submitReport(aggregateContext, 'user-10', '2026-03-09', 1);

  assert.strictEqual(tenthVote.success, true);
  assert.strictEqual(tenthVote.data.progress.reportCount, 10);
  assert.strictEqual(tenthVote.data.config.source, 'user_aggregate');
  assert.strictEqual(tenthVote.data.config.termStartDate, '2026-03-02');

  const adminOverride = await callAs(aggregateContext, 'admin-openid', {
    action: 'adminSaveTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: 'aggregate-term',
    term: 'Aggregate Term',
    weekNumber: 1,
    weekMondayDate: '2026-02-23'
  });

  assert.strictEqual(adminOverride.success, true);
  assert.strictEqual(adminOverride.data.config.source, 'admin');
  assert.strictEqual(adminOverride.data.config.termStartDate, '2026-02-23');

  const tieContext = createContext();
  const tieDates = [
    '2026-02-23',
    '2026-03-02',
    '2026-02-23',
    '2026-03-02',
    '2026-02-23',
    '2026-03-02',
    '2026-02-23',
    '2026-03-02',
    '2026-02-23',
    '2026-03-02',
    '2026-03-02'
  ];

  tieDates.forEach((date, index) => {
    const openid = `tie-user-${index + 1}`;
    bindUser(tieContext, openid);
    tieContext.fakeDb.setDoc('termWeekReports', `wtbu_tie-term_${openid}`, {
      _openid: openid,
      openid,
      schoolId: 'wtbu',
      schoolName: 'Wuhan Business University',
      semesterId: 'tie-term',
      term: 'Tie Term',
      weekNumber: 1,
      weekMondayDate: date,
      termStartDate: date,
      firstReportedAt: `2026-02-01T00:00:${String(index + 1).padStart(2, '0')}.000Z`,
      updatedAt: `2026-02-01T00:00:${String(index + 1).padStart(2, '0')}.000Z`
    });
  });

  const tieResult = await callAs(tieContext, 'tie-user-1', {
    action: 'getTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: 'tie-term',
    term: 'Tie Term'
  });

  assert.strictEqual(tieResult.success, true);
  assert.strictEqual(tieResult.data.progress.reportCount, 10);
  assert.strictEqual(tieResult.data.config.source, 'user_aggregate');
  assert.strictEqual(tieResult.data.config.termStartDate, '2026-02-23');
}

runTermWeekTests()
  .then(() => {
    console.log('term week config tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
