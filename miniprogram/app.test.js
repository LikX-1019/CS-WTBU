const assert = require('assert');

let appConfig = null;
const storage = {};
const cloudCalls = [];

global.App = (config) => {
  appConfig = config;
};

global.getCurrentPages = () => [];

global.wx = {
  reLaunch() {},
  showModal() {},
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
    init() {},
    callFunction({ data }) {
      cloudCalls.push(data || {});

      if (data && data.action === 'status') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              bound: true
            }
          }
        });
      }

      if (data && data.action === 'weather') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              schoolId: data.schoolId,
              schoolName: '武汉工商学院',
              displayText: '武汉工商学院 · 多云 29°C',
              weatherText: '多云',
              temperature: 29
            }
          }
        });
      }

      if (data && data.action === 'grades') {
        return Promise.resolve({
          result: {
            success: true,
            data: {
              cacheVersion: 3,
              summary: [],
              semesters: []
            }
          }
        });
      }

      return Promise.resolve({
        result: {
          success: true,
          data: {
            cacheVersion: 3,
            lastFetchedAt: new Date().toISOString(),
            term: 'spring-2026',
            selectedSemesterId: '2026',
            courses: [],
            exams: [],
            school: {
              id: 'wtbu',
              name: '武汉工商学院'
            },
            termWeek: {
              config: {
                termStartDate: '2026-03-02'
              }
            },
            termStartDate: '2026-03-02'
          }
        }
      });
    }
  }
};

require('./app');

async function run() {
  assert.strictEqual(typeof appConfig.onLaunch, 'function');

  appConfig.onLaunch();

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  assert.strictEqual(cloudCalls.some((call) => call.action === 'status'), true);
  assert.strictEqual(cloudCalls.some((call) => !call.action), true);
  assert.strictEqual(cloudCalls.some((call) => call.action === 'weather' && call.schoolId === 'wtbu'), true);
  assert.strictEqual(cloudCalls.some((call) => call.action === 'grades'), true);
}

run()
  .then(() => {
    console.log('app launch tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
