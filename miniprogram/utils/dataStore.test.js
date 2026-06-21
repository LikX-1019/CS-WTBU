const assert = require('assert');

const storage = {};
const cloudCalls = [];
const freshFetchedAt = new Date().toISOString();

global.wx = {
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  cloud: {
    callFunction({ data }) {
      cloudCalls.push(data);

      if (data && data.action === 'getTermWeekConfig') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              config: {
                termStartDate: data.semesterId === '2026' ? '2026-09-07' : '2026-03-02'
              }
            }
          }
        });
      }

      if (data && data.action === 'refresh' && data.semesterId === '2026') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              cacheVersion: 3,
              lastFetchedAt: freshFetchedAt,
              term: 'fall-2026',
              selectedSemesterId: '2026',
              courses: [{ id: 'course-2026', weekday: 1, sections: [1] }],
              semesters: [{ id: '2026', label: 'fall-2026', selected: true }],
              school: { id: 'wtbu' }
            }
          }
        });
      }

      if (data && data.action === 'profile') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              profile: { name: 'Fresh User' },
              studentId: '20260001',
              isAdmin: false,
              lastFetchedAt: freshFetchedAt
            }
          }
        });
      }

      if (data && data.action === 'refreshAll') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              refreshedAt: freshFetchedAt,
              schedule: {
                cacheVersion: 3,
                lastFetchedAt: freshFetchedAt,
                term: 'spring-2025',
                selectedSemesterId: '2025',
                courses: [{ id: 'course-2025', weekday: 2, sections: [1] }],
                semesters: [{ id: '2025', label: 'spring-2025', selected: true }],
                school: { id: 'wtbu' }
              },
              grades: {
                cacheVersion: 3,
                summary: [],
                semesters: []
              }
            }
          }
        });
      }

      return Promise.resolve({
        result: {
          success: true,
          data: {
            cacheVersion: 3,
            lastFetchedAt: freshFetchedAt,
            term: 'spring-2025',
            selectedSemesterId: '2025',
            courses: [{ id: 'course-2025', weekday: 2, sections: [1] }],
            semesters: [{ id: '2025', label: 'spring-2025', selected: true }],
            school: { id: 'wtbu' }
          }
        }
      });
    }
  }
};

const dataStore = require('./dataStore');

async function run() {
  dataStore.clearAll();

  const spring = {
    cacheVersion: 3,
    lastFetchedAt: freshFetchedAt,
    term: 'spring-2025',
    selectedSemesterId: '2025',
    courses: [{ id: 'course-2025', weekday: 2, sections: [1] }],
    school: { id: 'wtbu' }
  };
  const fall = {
    cacheVersion: 3,
    lastFetchedAt: freshFetchedAt,
    term: 'fall-2026',
    selectedSemesterId: '2026',
    courses: [{ id: 'course-2026', weekday: 3, sections: [1] }],
    school: { id: 'wtbu' }
  };

  dataStore.setSchedule(spring);
  dataStore.setCurrentSchedule(fall);

  const cacheMap = storage.scheduleDataBySemester;
  assert.strictEqual(Object.keys(cacheMap).length, 2);
  assert.strictEqual(cacheMap['2025'].term, 'spring-2025');
  assert.strictEqual(cacheMap['2026'].term, 'fall-2026');
  assert.strictEqual(dataStore.getSemesterScheduleCache('2025').term, 'spring-2025');
  assert.strictEqual(dataStore.getSemesterScheduleCache('2026').term, 'fall-2026');

  cloudCalls.length = 0;
  const loadedSpring = await dataStore.loadSchedule({ semesterId: '2025' });
  assert.strictEqual(loadedSpring.term, 'spring-2025');
  assert.strictEqual(cloudCalls.every((call) => call.action !== 'refresh'), true);

  cloudCalls.length = 0;
  const refreshedFall = await dataStore.loadSchedule({ semesterId: '2026', force: true });
  assert.strictEqual(refreshedFall.term, 'fall-2026');
  assert.strictEqual(cloudCalls.some((call) => call.action === 'refresh' && call.semesterId === '2026'), true);
  assert.strictEqual(storage.scheduleDataBySemester['2026'].term, 'fall-2026');

  dataStore.clearAll();
  storage.currentScheduleData = {
    cacheVersion: 3,
    lastFetchedAt: freshFetchedAt,
    term: 'cached-current',
    selectedSemesterId: '2025',
    termWeekConfig: {
      termStartDate: '2026-03-09'
    },
    termStartDate: '2026-03-09',
    courses: [{ id: 'course-cached', weekday: 2, sections: [1] }],
    school: { id: 'wtbu' }
  };
  cloudCalls.length = 0;
  const cachedCurrent = await dataStore.loadCurrentSchedule();
  assert.strictEqual(cachedCurrent.term, 'cached-current');
  assert.strictEqual(cachedCurrent.termStartDate, '2026-03-09');
  assert.strictEqual(cloudCalls.length, 0);

  dataStore.clearAll();
  storage.currentScheduleData = {
    cacheVersion: 3,
    lastFetchedAt: freshFetchedAt,
    term: 'cached-with-empty-term-week',
    selectedSemesterId: '2025',
    termWeek: {
      config: null,
      termStartDate: ''
    },
    courses: [{ id: 'course-empty-term-week', weekday: 2, sections: [1] }],
    school: { id: 'wtbu' }
  };
  cloudCalls.length = 0;
  const refilledTermWeek = await dataStore.loadCurrentSchedule();
  assert.strictEqual(refilledTermWeek.term, 'cached-with-empty-term-week');
  assert.strictEqual(refilledTermWeek.termStartDate, '2026-03-02');
  assert.strictEqual(cloudCalls.some((call) => call.action === 'getTermWeekConfig' && call.semesterId === '2025'), true);

  dataStore.clearAll();
  storage.currentScheduleData = {
    cacheVersion: 3,
    lastFetchedAt: '2020-01-01T00:00:00.000Z',
    term: 'stale-current',
    selectedSemesterId: '2025',
    courses: [{ id: 'course-stale', weekday: 2, sections: [1] }],
    school: { id: 'wtbu' }
  };
  cloudCalls.length = 0;
  const reloadedCurrent = await dataStore.loadCurrentSchedule();
  assert.strictEqual(reloadedCurrent.term, 'stale-current');
  assert.strictEqual(cloudCalls.some((call) => !call.action), false);

  dataStore.clearAll();
  storage.gradesData = {
    cacheVersion: 3,
    summary: [{ label: 'Cached Grade', value: '99' }],
    semesters: []
  };
  cloudCalls.length = 0;
  const cachedGrades = await dataStore.loadGrades();
  assert.strictEqual(cachedGrades.summary[0].label, 'Cached Grade');
  assert.strictEqual(cloudCalls.some((call) => call.action === 'grades'), false);

  dataStore.clearAll();
  dataStore.setProfile({
    profile: { name: 'Old User' },
    studentId: '20260001',
    isAdmin: false,
    lastFetchedAt: '2020-01-01T00:00:00.000Z'
  });
  cloudCalls.length = 0;
  const reloadedProfile = await dataStore.loadProfile();
  assert.strictEqual(reloadedProfile.profile.name, 'Old User');
  assert.strictEqual(cloudCalls.some((call) => call.action === 'profile'), false);

  dataStore.setProfile({
    profile: { name: 'Profile Cache' },
    studentId: '20260001',
    isAdmin: false,
    lastFetchedAt: '2020-01-01T00:00:00.000Z'
  });
  cloudCalls.length = 0;
  await dataStore.refreshEduCache();
  assert.strictEqual(storage.profileData.lastFetchedAt, '2020-01-01T00:00:00.000Z');
  assert.strictEqual(storage.currentScheduleData.term, 'spring-2025');
  assert.strictEqual(storage.gradesData.cacheVersion, 3);
  assert.strictEqual(cloudCalls.some((call) => call.action === 'refreshAll'), true);

  dataStore.clearAll();
  dataStore.setSchedule({
    cacheVersion: 3,
    lastFetchedAt: freshFetchedAt,
    term: 'old-account',
    selectedSemesterId: 'old',
    courses: [{ id: 'course-old', weekday: 1, sections: [1] }],
    school: { id: 'wtbu' }
  });
  dataStore.replaceBoundAccountData({
    cacheVersion: 3,
    lastFetchedAt: freshFetchedAt,
    term: 'new-account',
    selectedSemesterId: 'new',
    courses: [{ id: 'course-new', weekday: 2, sections: [1] }],
    school: { id: 'wtbu' },
    grades: { cacheVersion: 3, summary: [], semesters: [] },
    profile: { name: 'New User' },
    studentId: '20260002'
  }, '20260002');
  assert.strictEqual(storage.scheduleDataBySemester.old, undefined);
  assert.strictEqual(storage.scheduleDataBySemester.new.term, 'new-account');
  assert.strictEqual(storage.scheduleData.term, 'new-account');
  assert.strictEqual(storage.currentScheduleData.term, 'new-account');
  assert.strictEqual(storage.profileData.studentId, '20260002');

  dataStore.clearAll();
  assert.strictEqual(storage.scheduleDataBySemester, undefined);
}

run()
  .then(() => {
    console.log('data store tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
