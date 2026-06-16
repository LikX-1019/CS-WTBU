const assert = require('assert');

const storage = {};
const cloudCalls = [];

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
              term: '2026-2027学年第一学期',
              selectedSemesterId: '2026',
              courses: [{ id: 'course-2026', weekday: 1, sections: [1] }],
              semesters: [{ id: '2026', label: '2026-2027学年第一学期', selected: true }],
              school: { id: 'wtbu' }
            }
          }
        });
      }

      return Promise.resolve({
        result: {
          success: true,
          data: {
            cacheVersion: 3,
            term: '2025-2026学年第二学期',
            selectedSemesterId: '2025',
            courses: [{ id: 'course-2025', weekday: 2, sections: [1] }],
            semesters: [{ id: '2025', label: '2025-2026学年第二学期', selected: true }],
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
    term: '2025-2026学年第二学期',
    selectedSemesterId: '2025',
    courses: [{ id: 'course-2025', weekday: 2, sections: [1] }],
    school: { id: 'wtbu' }
  };
  const fall = {
    cacheVersion: 3,
    term: '2026-2027学年第一学期',
    selectedSemesterId: '2026',
    courses: [{ id: 'course-2026', weekday: 3, sections: [1] }],
    school: { id: 'wtbu' }
  };

  dataStore.setSchedule(spring);
  dataStore.setCurrentSchedule(fall);

  const cacheMap = storage.scheduleDataBySemester;
  assert.strictEqual(Object.keys(cacheMap).length, 2);
  assert.strictEqual(cacheMap['2025'].term, '2025-2026学年第二学期');
  assert.strictEqual(cacheMap['2026'].term, '2026-2027学年第一学期');
  assert.strictEqual(dataStore.getSemesterScheduleCache('2025').term, '2025-2026学年第二学期');
  assert.strictEqual(dataStore.getSemesterScheduleCache('2026').term, '2026-2027学年第一学期');

  cloudCalls.length = 0;
  const loadedSpring = await dataStore.loadSchedule({ semesterId: '2025' });
  assert.strictEqual(loadedSpring.term, '2025-2026学年第二学期');
  assert.strictEqual(cloudCalls.every((call) => call.action !== 'refresh'), true);

  cloudCalls.length = 0;
  const refreshedFall = await dataStore.loadSchedule({ semesterId: '2026', force: true });
  assert.strictEqual(refreshedFall.term, '2026-2027学年第一学期');
  assert.strictEqual(cloudCalls.some((call) => call.action === 'refresh' && call.semesterId === '2026'), true);
  assert.strictEqual(storage.scheduleDataBySemester['2026'].term, '2026-2027学年第一学期');

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
