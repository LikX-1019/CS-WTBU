const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const indexPath = path.resolve(__dirname, '../index.js');
const source = fs.readFileSync(indexPath, 'utf8');
const localRequire = createRequire(indexPath);

process.env.EDU_PASSWORD_SECRET = 'a'.repeat(64);

const wtbu = localRequire('./schools/wtbu');
const { getSchool } = localRequire('./schools');
const parseSemesters = wtbu.__test__.parseSemesters;
const dedupeSemesters = wtbu.__test__.dedupeSemesters;
const fetchSchedule = wtbu.__test__.fetchSchedule;
const fetchScheduleWithClient = wtbu.__test__.fetchScheduleWithClient;
const setSemesterSwitchDelayMs = wtbu.__test__.setSemesterSwitchDelayMs;

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

    if (name === 'axios') {
      return context.axiosMock;
    }

    return localRequire(name);
  }
};

context.axiosMock = localRequire('axios');

context.global = context;
vm.runInNewContext(source, context, { filename: indexPath });

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

const scheduleSemesters = parseSemesters(`
<input name="semester.id" value="488">
<input type="text" value="2025-2026学年第二学期">
<script>
  var semesterCalendar = [
    { id: 420, schoolYear: '2024-2025', term: '2' },
    { id: 487, schoolYear: '2025-2026', term: '1' },
    { id: 488, schoolYear: '2025-2026', term: '2' },
    { semesterId: '489', semesterName: '2026-2027学年第一学期' }
  ];
</script>
`);

assert.deepStrictEqual(scheduleSemesters.map((semester) => ({
  id: semester.id,
  label: semester.label,
  selected: semester.selected
})), [
  { id: '489', label: '2026-2027学年第一学期', selected: false },
  { id: '488', label: '2025-2026学年第二学期', selected: true },
  { id: '487', label: '2025-2026学年第一学期', selected: false }
]);

assert.deepStrictEqual(dedupeSemesters([
  { id: '488', label: '2025-2026学年第二学期', selected: true },
  { id: '999', label: '2025-2026学年第二学期' },
  { id: '489', label: '2026-2027学年第一学期' }
]).map((semester) => semester.label), [
  '2026-2027学年第一学期',
  '2025-2026学年第二学期'
]);

async function runScheduleFetchTest() {
  const calls = [];
  const scheduleClient = {
    async get(pathName) {
      calls.push(`get:${pathName}`);
      return {
        data: `
          <input name="semester.id" value="487">
          <script>bg.form.addInput(form, "ids", "std-1");</script>
          <select name="semester.id">
            <option value="487" selected>2025-2026学年第一学期</option>
            <option value="488">2025-2026学年第二学期</option>
          </select>
        `
      };
    },
    async post(pathName, payload) {
      calls.push(`post:${pathName}:${payload}`);
      return { data: '<table></table>' };
    }
  };

  try {
    setSemesterSwitchDelayMs(5);
    await fetchSchedule(scheduleClient, { semesterId: '488' });
  } finally {
    setSemesterSwitchDelayMs(2000);
  }

  assert.strictEqual(calls[calls.length - 1].split(':')[0], 'post');
  assert.ok(calls[calls.length - 1].includes('semester.id=488'));
}

async function runFetchAllSemesterCoursesTest() {
  const semesterIds = ['491', '490', '489', '488', '487'];
  const requestedSemesterIds = [];
  const scheduleClient = {
    async get() {
      return {
        data: `
          <input name="semester.id" value="491">
          <script>bg.form.addInput(form, "ids", "std-1");</script>
          <select name="semester.id">
            ${semesterIds.map((id, index) => `
              <option value="${id}"${index === 0 ? ' selected' : ''}>semester ${id}</option>
            `).join('')}
          </select>
        `
      };
    },
    async post(pathName, payload) {
      const semesterId = String(payload).match(/semester\.id=([^&]+)/)[1];
      requestedSemesterIds.push(decodeURIComponent(semesterId));
      return {
        data: `<h3>term-${semesterId}</h3>`
      };
    }
  };

  try {
    setSemesterSwitchDelayMs(0);
    const result = await fetchScheduleWithClient(scheduleClient, '', 'student-1', {
      includeAllSemesterCourses: true
    });

    assert.deepStrictEqual(
      result.schedule.semesterCourses.map((group) => group.semesterId),
      semesterIds
    );
    assert.deepStrictEqual(requestedSemesterIds, semesterIds);
  } finally {
    setSemesterSwitchDelayMs(2000);
  }
}

async function runFetchAllKeepsCurrentExamTest() {
  const events = [];
  const scheduleClient = {
    async get(pathName) {
      events.push(`get:${pathName || ''}`);

      if (String(pathName || '').toLowerCase().includes('exam')) {
        return {
          data: '<table></table>'
        };
      }

      return {
        data: `
          <input name="semester.id" value="491">
          <script>bg.form.addInput(form, "ids", "std-1");</script>
          <select name="semester.id">
            <option value="491" selected>semester 491</option>
            <option value="490">semester 490</option>
          </select>
          <a href="/eams/stdExamTable.action">考试安排</a>
        `
      };
    },
    async post(pathName, payload) {
      const semesterId = String(payload).match(/semester\.id=([^&]+)/)[1];
      events.push(`schedule:${decodeURIComponent(semesterId)}`);
      return {
        data: `<h3>term-${semesterId}</h3>`
      };
    }
  };

  try {
    setSemesterSwitchDelayMs(0);
    await fetchScheduleWithClient(scheduleClient, '', 'student-1', {
      includeExams: true,
      includeAllSemesterCourses: true
    });

    const examIndex = events.findIndex((event) => event.toLowerCase().includes('exam'));
    const switchedIndex = events.findIndex((event) => event === 'schedule:490');

    assert.ok(examIndex >= 0);
    assert.ok(switchedIndex >= 0);
    assert.ok(examIndex < switchedIndex);
  } finally {
    setSemesterSwitchDelayMs(2000);
  }
}

function createSchedule(id) {
  return {
    term: `term-${id}`,
    selectedSemesterId: id,
    courses: [{ id: `course-${id}`, weekday: 1, sections: [1] }],
    semesters: [{ id, label: `semester ${id}` }]
  };
}

function createStoredSchedule(id) {
  const schedule = createSchedule(id);

  return Object.assign({}, schedule, {
    courses: [{
      semesterId: id,
      term: schedule.term,
      label: schedule.term,
      courses: schedule.courses
    }],
    semesterCourses: [{
      semesterId: id,
      term: schedule.term,
      label: schedule.term,
      courses: schedule.courses
    }]
  });
}

function createAggregatedSchedule(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id, index) => ({
    id,
    label: `semester ${id}`,
    selected: index === 0
  }));

  return {
    term: `term-${ids[0]}`,
    selectedSemesterId: ids[0],
    courses: ids.map((id) => ({
      semesterId: id,
      term: `term-${id}`,
      label: `semester ${id}`,
      courses: [{ id: `course-${id}`, weekday: 1, sections: [1] }]
    })),
    semesterCourses: ids.map((id) => ({
      semesterId: id,
      term: `term-${id}`,
      label: `semester ${id}`,
      courses: [{ id: `course-${id}`, weekday: 1, sections: [1] }]
    })),
    semesters: list
  };
}

function createIndexedOnlyAggregatedSchedule(ids) {
  return {
    term: `term-${ids[0]}`,
    selectedSemesterId: ids[0],
    courses: ids.map((id) => ({
      term: `term-${id}`,
      label: `semester ${id}`,
      courses: [{ id: `course-${id}`, weekday: 1, sections: [1] }]
    })),
    semesters: ids.map((id, index) => ({
      id,
      label: `semester ${id}`,
      selected: index === 0
    }))
  };
}

function createGrades(id) {
  return {
    summary: [{ label: 'totalCredit', value: id }],
    semesters: [{ id, title: `grades ${id}`, grades: [] }]
  };
}

function createCachedGrades(id) {
  return Object.assign(createGrades(id), {
    cacheVersion: 3
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
    cacheVersion: 3,
    scheduleCaches: {}
  }, overrides);
}

function useFakeDb(binding) {
  const state = {
    binding,
    updates: [],
    sets: [],
    collections: {}
  };

  function listDocs(name) {
    if (name === 'eduAccountBindings' && state.binding) {
      return [{
        _id: 'test-openid',
        ...state.binding
      }];
    }

    return Array.isArray(state.collections[name]) ? state.collections[name].map((doc, index) => ({
      _id: doc._id || `${name}-${index}`,
      ...doc
    })) : [];
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

  function createQuery(name, stateShape = {}) {
    return {
      field(fields) {
        return createQuery(name, {
          ...stateShape,
          fields
        });
      },
      orderBy(field, direction) {
        return createQuery(name, {
          ...stateShape,
          orderField: field,
          orderDirection: direction
        });
      },
      limit(limitValue) {
        return createQuery(name, {
          ...stateShape,
          limitValue: Number(limitValue) || 0
        });
      },
      async get() {
        let docs = listDocs(name);

        if (stateShape.orderField) {
          const factor = stateShape.orderDirection === 'desc' ? -1 : 1;
          docs = docs.sort((left, right) => String(left[stateShape.orderField] || '').localeCompare(String(right[stateShape.orderField] || '')) * factor);
        }

        if (stateShape.limitValue > 0) {
          docs = docs.slice(0, stateShape.limitValue);
        }

        return {
          data: docs.map((doc) => applyFields(doc, stateShape.fields))
        };
      }
    };
  }

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
        },
        field(fields) {
          return createQuery(name).field(fields);
        },
        orderBy(field, direction) {
          return createQuery(name).orderBy(field, direction);
        },
        limit(limitValue) {
          return createQuery(name).limit(limitValue);
        }
      };
    }
  };

  return state;
}

async function runCacheTests() {
  await runScheduleFetchTest();
  await runFetchAllSemesterCoursesTest();
  await runFetchAllKeepsCurrentExamTest();

  const schoolsResult = await context.exports.main({ action: 'schools' });
  assert.strictEqual(schoolsResult.success, true);
  assert.strictEqual(schoolsResult.data.defaultSchoolId, 'wtbu');
  assert.strictEqual(schoolsResult.data.schools[0].id, 'wtbu');
  assert.deepStrictEqual(schoolsResult.data.schools[0].weatherLocation, {
    name: '武汉工商学院',
    latitude: 30.4611,
    longitude: 114.279297
  });
  assert.strictEqual(typeof getSchool('wtbu').adapter.fetchAllByCredentials, 'function');

  const weatherRequests = [];
  const originalAxiosGet = context.axiosMock.get;
  context.axiosMock.get = (url, options) => {
    weatherRequests.push({ url, options });

    return Promise.resolve({
      data: {
        current: {
          temperature_2m: 28.6,
          weather_code: 2,
          time: '2026-06-21T10:00'
        }
      }
    });
  };
  const weatherResult = await context.exports.main({ action: 'weather', schoolId: 'wtbu' });
  assert.strictEqual(weatherResult.success, true);
  assert.strictEqual(weatherResult.data.displayText, '武汉工商学院 · 多云 29°C');
  assert.strictEqual(weatherResult.data.weatherText, '多云');
  assert.strictEqual(weatherResult.data.temperature, 28.6);
  assert.strictEqual(weatherRequests.length, 1);
  assert.strictEqual(weatherRequests[0].url, 'https://api.open-meteo.com/v1/forecast');
  assert.strictEqual(weatherRequests[0].options.params.latitude, 30.4611);
  assert.strictEqual(weatherRequests[0].options.params.longitude, 114.279297);
  assert.strictEqual(weatherRequests[0].options.params.current, 'temperature_2m,weather_code');

  context.axiosMock.get = () => {
    return Promise.reject(new Error('network failed'));
  };
  const weatherError = await context.exports.main({ action: 'weather', schoolId: 'wtbu' });
  assert.strictEqual(weatherError.success, false);
  assert.strictEqual(weatherError.code, 'WEATHER_UNAVAILABLE');
  context.axiosMock.get = originalAxiosGet;

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

  const freshBinding = createBinding();
  useFakeDb(freshBinding);
  const freshSchedule = await context.getBoundSchedule();
  const freshGrades = await context.getBoundGrades();
  assert.strictEqual(freshSchedule.data.term, freshBinding.lastSchedule.term);
  assert.deepStrictEqual(freshSchedule.data.exams, freshBinding.lastExams);
  assert.deepStrictEqual(toPlain(freshGrades.data), freshBinding.lastGrades);

  const manuallyUpdatedAt = '2026-06-20T08:30:00.000Z';
  const manuallyUpdatedBinding = createBinding({
    lastFetchedAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    _updateTime: manuallyUpdatedAt
  });
  useFakeDb(manuallyUpdatedBinding);
  const manuallyUpdatedSchedule = await context.getBoundSchedule();
  const manuallyUpdatedProfile = await context.exports.main({ action: 'profile' });
  assert.strictEqual(manuallyUpdatedSchedule.data.lastFetchedAt, manuallyUpdatedAt);
  assert.strictEqual(manuallyUpdatedProfile.data.lastFetchedAt, manuallyUpdatedAt);

  const invalidCipherBinding = createBinding({
    passwordCipher: 'invalid-cipher'
  });
  useFakeDb(invalidCipherBinding);
  const invalidCipherStatus = await context.exports.main({ action: 'status' });
  const invalidCipherSchedule = await context.getBoundSchedule();
  const invalidCipherGrades = await context.getBoundGrades();
  const invalidCipherProfile = await context.exports.main({ action: 'profile' });
  const invalidCipherSavedProfile = await context.exports.main({
    action: 'saveProfile',
    profile: {
      phone: '13800000000'
    }
  });
  const invalidCipherRefresh = await context.exports.main({ action: 'refreshAll' });
  assert.strictEqual(invalidCipherStatus.success, true);
  assert.strictEqual(invalidCipherStatus.data.bound, true);
  assert.strictEqual(invalidCipherStatus.data.canRefresh, true);
  assert.strictEqual(invalidCipherSchedule.data.term, invalidCipherBinding.lastSchedule.term);
  assert.deepStrictEqual(toPlain(invalidCipherGrades.data), invalidCipherBinding.lastGrades);
  assert.strictEqual(invalidCipherProfile.success, true);
  assert.strictEqual(invalidCipherSavedProfile.success, true);
  assert.strictEqual(invalidCipherSavedProfile.data.profile.phone, '13800000000');
  assert.strictEqual(invalidCipherRefresh.success, false);
  assert.strictEqual(invalidCipherRefresh.code, 'BINDING_INVALID');

  const oldAccountBinding = createBinding({
    studentId: '20260001',
    schoolId: 'wtbu',
    scheduleCaches: {
      old: {
        cacheVersion: 3,
        schedule: createStoredSchedule('old'),
        exams: [{ id: 'exam-old' }],
        fetchedAt: '2026-06-01T00:00:00.000Z'
      }
    },
    lastGrades: createCachedGrades('old')
  });
  const rebindState = useFakeDb(oldAccountBinding);
  context.fetchAllByCredentials = async (studentId, password, options) => {
    assert.strictEqual(studentId, '20260002');
    assert.strictEqual(password, 'new-pw');
    assert.strictEqual(options.schoolId, 'wtbu');
    return {
      schedule: createSchedule('new'),
      exams: [{ id: 'exam-new' }],
      grades: createGrades('new'),
      profile: { name: 'New User' }
    };
  };

  const rebindResult = await context.exports.main({
    action: 'bind',
    schoolId: 'wtbu',
    studentId: '20260002',
    password: 'new-pw'
  });
  assert.strictEqual(rebindResult.success, true);
  assert.strictEqual(rebindState.sets.length, 1);
  assert.strictEqual(rebindState.sets[0].options.data.studentId, '20260002');
  assert.strictEqual(rebindState.sets[0].options.data.scheduleCaches.old, undefined);
  assert.strictEqual(rebindState.sets[0].options.data.scheduleCaches.new.schedule.term, 'term-new');
  assert.deepStrictEqual(toPlain(rebindState.sets[0].options.data.lastGrades), createCachedGrades('new'));

  const manualBinding = createBinding();
  const manualState = useFakeDb(manualBinding);
  context.fetchAllByCredentials = async () => {
    return {
      schedule: createSchedule('manual'),
      exams: [{ id: 'exam-manual' }],
      grades: createGrades('manual'),
      profile: null
    };
  };

  const manualResult = await context.exports.main({ action: 'refreshAll' });
  assert.strictEqual(manualResult.success, true);
  assert.strictEqual(manualResult.data.schedule.term, 'term-manual');
  assert.deepStrictEqual(toPlain(manualResult.data.grades), createCachedGrades('manual'));
  assert.strictEqual(manualState.updates.length, 1);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(manualState.updates[0].options.data, 'profile'),
    false
  );

  const refreshCurrentBinding = createBinding();
  const refreshCurrentState = useFakeDb(refreshCurrentBinding);
  context.fetchScheduleByCredentials = async () => {
    return {
      schedule: createSchedule('current-refreshed-only'),
      exams: [{ id: 'exam-current-refreshed-only' }]
    };
  };

  const refreshCurrentResult = await context.exports.main({ action: 'refresh' });
  assert.strictEqual(refreshCurrentResult.success, true);
  assert.strictEqual(refreshCurrentResult.data.term, 'term-current-refreshed-only');
  assert.strictEqual(refreshCurrentState.updates.length, 1);
  assert.deepStrictEqual(
    toPlain(refreshCurrentState.updates[0].options.data.scheduleCaches.__set.current.schedule),
    createStoredSchedule('current-refreshed-only')
  );

  const refreshSemesterBinding = createBinding();
  const refreshSemesterState = useFakeDb(refreshSemesterBinding);
  context.fetchScheduleByCredentials = async (studentId, password, options) => {
    assert.strictEqual(studentId, refreshSemesterBinding.studentId);
    assert.strictEqual(password, 'pw');
    assert.strictEqual(options.schoolId, 'wtbu');
    assert.strictEqual(options.includeExams, true);
    assert.strictEqual(options.semesterId, '2023');
    return {
      schedule: createSchedule('2023'),
      exams: [{ id: 'exam-2023-refresh' }]
    };
  };

  const refreshSemesterResult = await context.exports.main({
    action: 'refresh',
    semesterId: '2023'
  });

  assert.strictEqual(refreshSemesterResult.success, true);
  assert.strictEqual(refreshSemesterResult.data.selectedSemesterId, '2023');
  assert.strictEqual(refreshSemesterState.updates.length, 1);
  assert.deepStrictEqual(
    toPlain(refreshSemesterState.updates[0].options.data.scheduleCaches.__set['2023'].schedule),
    createStoredSchedule('2023')
  );

  const aggregatedBinding = createBinding({
    lastSchedule: createAggregatedSchedule(['2024', '2023', '2022']),
    lastExams: [{ id: 'exam-current' }],
    scheduleCaches: {}
  });
  useFakeDb(aggregatedBinding);

  const aggregatedSemester = await context.getBoundSchedule({ semesterId: '2023' });

  assert.strictEqual(aggregatedSemester.success, true);
  assert.strictEqual(aggregatedSemester.data.selectedSemesterId, '2023');
  assert.deepStrictEqual(
    toPlain(aggregatedSemester.data.courses),
    [{ id: 'course-2023', weekday: 1, sections: [1] }]
  );

  const indexedOnlyBinding = createBinding({
    lastSchedule: createIndexedOnlyAggregatedSchedule(['2024', '2023', '2022']),
    lastExams: [{ id: 'exam-current' }],
    scheduleCaches: {}
  });
  useFakeDb(indexedOnlyBinding);

  const indexedOnlySemester = await context.getBoundSchedule({ semesterId: '2023' });

  assert.strictEqual(indexedOnlySemester.success, true);
  assert.strictEqual(indexedOnlySemester.data.selectedSemesterId, '2023');
  assert.deepStrictEqual(
    toPlain(indexedOnlySemester.data.courses),
    [{ id: 'course-2023', weekday: 1, sections: [1] }]
  );
}

runCacheTests()
  .then(() => {
    console.log('grade parser and cache tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
