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
          docs = docs.filter((doc) => Object.keys(criteria).every((key) => doc[key] === criteria[key]));
        });

        if (state.orderField) {
          const factor = state.orderDirection === 'desc' ? -1 : 1;
          docs.sort((left, right) => String(left[state.orderField] || '').localeCompare(String(right[state.orderField] || '')) * factor);
        }

        if (state.limitValue > 0) {
          docs = docs.slice(0, state.limitValue);
        }

        return {
          data: docs.map((doc) => {
            if (!state.fields) {
              return doc;
            }

            const projected = {};
            Object.keys(state.fields).forEach((key) => {
              if (state.fields[key] && Object.prototype.hasOwnProperty.call(doc, key)) {
                projected[key] = doc[key];
              }
            });
            return projected;
          })
        };
      }
    };
  }

  return {
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
    }
  };
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

function bindUser(context, openid) {
  context.fakeDb.setDoc('eduAccountBindings', openid, {
    studentId: `student-${openid}`,
    passwordCipher: 'cipher',
    schoolId: 'wtbu',
    schoolName: 'Wuhan Business University',
    lastFetchedAt: '2026-02-01T00:00:00.000Z',
    cacheVersion: 3,
    lastSchedule: {
      courses: [],
      selectedSemesterId: '262',
      term: '2026-2027学年第一学期',
      semesters: [
        { id: '262', label: '2026-2027学年第一学期', selected: true },
        { id: '242', label: '2025-2026学年第二学期' },
        { id: '222', label: '2025-2026学年第一学期' }
      ]
    },
    lastExams: [],
    lastGrades: { summary: [], semesters: [], cacheVersion: 3 },
    scheduleCaches: {
      262: {
        schedule: {
          courses: [],
          selectedSemesterId: '262',
          term: '2026-2027学年第一学期',
          semesters: [{ id: '262', label: '2026-2027学年第一学期', selected: true }]
        },
        exams: [],
        cacheVersion: 3,
        fetchedAt: '2026-09-16T00:00:00.000Z'
      },
      242: {
        schedule: {
          courses: [],
          selectedSemesterId: '242',
          term: '2025-2026学年第二学期',
          semesters: [{ id: '242', label: '2025-2026学年第二学期', selected: true }]
        },
        exams: [],
        cacheVersion: 3,
        fetchedAt: '2026-06-16T00:00:00.000Z'
      }
    }
  });
}

async function callAs(context, openid, event) {
  context.currentOpenid = openid;
  return context.exports.main(event);
}

async function runTests() {
  const context = createContext();
  bindUser(context, 'admin-openid');

  const saveSecondSemester = await callAs(context, 'admin-openid', {
    action: 'adminSaveTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: '242',
    term: '2025-2026学年第二学期',
    weekNumber: 1,
    weekMondayDate: '2026-03-02'
  });

  assert.strictEqual(saveSecondSemester.success, true);
  assert.strictEqual(saveSecondSemester.data.config.semesterId, '242');
  assert.strictEqual(saveSecondSemester.data.config.termStartDate, '2026-03-02');

  const saveFirstSemester = await callAs(context, 'admin-openid', {
    action: 'adminSaveTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: '222',
    term: '2025-2026学年第一学期',
    weekNumber: 1,
    weekMondayDate: '2025-09-08'
  });

  assert.strictEqual(saveFirstSemester.success, true);
  assert.strictEqual(saveFirstSemester.data.config.semesterId, '222');
  assert.strictEqual(saveFirstSemester.data.config.termStartDate, '2025-09-08');
  assert.strictEqual(context.fakeDb.getDoc('termWeekConfigs', 'wtbu_222').termStartDate, '2025-09-08');
  assert.strictEqual(context.fakeDb.getDoc('termWeekConfigs', 'wtbu_242').termStartDate, '2026-03-02');

  const directRead = await callAs(context, 'admin-openid', {
    action: 'getTermWeekConfig',
    schoolId: 'wtbu',
    semesterId: '222',
    term: '2025-2026学年第一学期',
    label: '2025-2026学年第一学期'
  });

  assert.strictEqual(directRead.success, true);
  assert.strictEqual(directRead.data.config.semesterId, '222');

  const adminList = await callAs(context, 'admin-openid', {
    action: 'adminListTermWeekConfigs'
  });

  assert.strictEqual(adminList.success, true);
  const autoCreatedConfigIds = clone(adminList.data.items.map((item) => item.id)).sort();
  assert.deepStrictEqual(autoCreatedConfigIds, ['wtbu_222', 'wtbu_242', 'wtbu_262']);
}

runTests()
  .then(() => {
    console.log('term week config tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
