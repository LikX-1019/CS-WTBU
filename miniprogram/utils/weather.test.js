const assert = require('assert');

const storage = {};
const cloudCalls = [];
let now = new Date('2026-06-21T02:00:00.000Z').getTime();
const realDateNow = Date.now;

Date.now = () => now;

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

      if (data && data.schoolId === 'fail') {
        return Promise.resolve({
          result: {
            success: false,
            code: 'WEATHER_UNAVAILABLE',
            message: '天气加载失败'
          }
        });
      }

      return Promise.resolve({
        result: {
          success: true,
          data: {
            schoolId: data.schoolId,
            schoolName: '武汉工商学院',
            weatherText: '多云',
            temperature: 29,
            displayText: '武汉工商学院 · 多云 29°C',
            updatedAt: '2026-06-21T10:00'
          }
        }
      });
    }
  }
};

const weather = require('./weather');

async function run() {
  weather.clearWeatherCache();

  const schedule = {
    school: {
      id: 'wtbu',
      name: '武汉工商学院'
    }
  };

  const first = await weather.preloadWeatherForSchedule(schedule);
  assert.strictEqual(first.displayText, '武汉工商学院 · 多云 29°C');
  assert.strictEqual(cloudCalls.length, 1);
  assert.strictEqual(cloudCalls[0].action, 'weather');
  assert.strictEqual(cloudCalls[0].schoolId, 'wtbu');
  assert.strictEqual(weather.getWeatherDisplayText(schedule), '武汉工商学院 · 多云 29°C');

  const second = await weather.preloadWeatherForSchedule(schedule);
  assert.strictEqual(second.displayText, '武汉工商学院 · 多云 29°C');
  assert.strictEqual(cloudCalls.length, 1);

  now += weather.WEATHER_CACHE_TTL_MS + 1;
  await weather.preloadWeatherForSchedule(schedule);
  assert.strictEqual(cloudCalls.length, 2);

  weather.clearWeatherCache();
  const concurrent = await Promise.all([
    weather.loadWeatherForSchool('wtbu', '武汉工商学院'),
    weather.loadWeatherForSchool('wtbu', '武汉工商学院')
  ]);
  assert.strictEqual(concurrent[0].displayText, '武汉工商学院 · 多云 29°C');
  assert.strictEqual(concurrent[1].displayText, '武汉工商学院 · 多云 29°C');
  assert.strictEqual(cloudCalls.length, 3);

  weather.setWeatherCache('fail', {
    displayText: '旧天气'
  });
  now += weather.WEATHER_CACHE_TTL_MS + 1;
  const stale = await weather.loadWeatherForSchool('fail', '武汉工商学院');
  assert.strictEqual(stale.displayText, '旧天气');

  weather.clearWeatherCache();
  const fallback = await weather.loadWeatherForSchool('fail', '武汉工商学院');
  assert.strictEqual(fallback.displayText, '武汉工商学院 · 天气暂不可用');
  assert.strictEqual(weather.getWeatherDisplayText({ school: { id: 'unknown', name: '未知学校' } }), '未知学校 · 天气暂不可用');
}

run()
  .then(() => {
    Date.now = realDateNow;
    console.log('weather tests passed');
  })
  .catch((error) => {
    Date.now = realDateNow;
    console.error(error);
    process.exit(1);
  });
