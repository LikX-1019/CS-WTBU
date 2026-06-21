const { callGetSchedule } = require('./api');

const WEATHER_CACHE_KEY = 'schoolWeatherCache';
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SCHOOL_ID = 'wtbu';
const DEFAULT_SCHOOL_NAME = '\u6b66\u6c49\u5de5\u5546\u5b66\u9662';
const FALLBACK_SUFFIX = '\u5929\u6c14\u6682\u4e0d\u53ef\u7528';

const store = {
  weatherBySchool: {},
  loadingBySchool: {}
};

function getSchoolIdFromSchedule(schedule) {
  const school = schedule && schedule.school || {};
  return String(school.id || schedule && schedule.schoolId || DEFAULT_SCHOOL_ID).trim() || DEFAULT_SCHOOL_ID;
}

function getSchoolNameFromSchedule(schedule) {
  const school = schedule && schedule.school || {};
  return String(school.name || DEFAULT_SCHOOL_NAME).trim() || DEFAULT_SCHOOL_NAME;
}

function getFallbackText(schoolName = DEFAULT_SCHOOL_NAME) {
  return `${schoolName || DEFAULT_SCHOOL_NAME} \u00b7 ${FALLBACK_SUFFIX}`;
}

function normalizeWeatherCacheMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

function getStoredWeatherMap() {
  if (store.weatherBySchool && Object.keys(store.weatherBySchool).length > 0) {
    return store.weatherBySchool;
  }

  try {
    const cached = wx.getStorageSync(WEATHER_CACHE_KEY) || {};
    store.weatherBySchool = normalizeWeatherCacheMap(cached);
  } catch (error) {
    store.weatherBySchool = {};
  }

  return store.weatherBySchool;
}

function setStoredWeatherMap(cacheMap) {
  const normalized = normalizeWeatherCacheMap(cacheMap);
  store.weatherBySchool = normalized;

  try {
    wx.setStorageSync(WEATHER_CACHE_KEY, normalized);
  } catch (error) {}
}

function isFreshWeather(item, now = Date.now()) {
  const cachedAt = new Date(item && item.cachedAt || '').getTime();

  return Number.isFinite(cachedAt) && now - cachedAt <= WEATHER_CACHE_TTL_MS;
}

function getWeatherCache(schoolId = DEFAULT_SCHOOL_ID, options = {}) {
  const normalizedSchoolId = String(schoolId || DEFAULT_SCHOOL_ID).trim() || DEFAULT_SCHOOL_ID;
  const cacheMap = getStoredWeatherMap();
  const cached = cacheMap[normalizedSchoolId] || null;

  if (!cached) {
    return null;
  }

  if (!options.allowStale && !isFreshWeather(cached)) {
    return null;
  }

  return cached;
}

function setWeatherCache(schoolId, data) {
  const normalizedSchoolId = String(schoolId || DEFAULT_SCHOOL_ID).trim() || DEFAULT_SCHOOL_ID;
  const displayText = data && data.displayText ? String(data.displayText) : '';

  if (!displayText) {
    return null;
  }

  const nextItem = Object.assign({}, data, {
    schoolId: normalizedSchoolId,
    cachedAt: new Date(Date.now()).toISOString()
  });
  const cacheMap = Object.assign({}, getStoredWeatherMap(), {
    [normalizedSchoolId]: nextItem
  });

  setStoredWeatherMap(cacheMap);

  return nextItem;
}

function loadWeatherForSchool(schoolId, schoolName = DEFAULT_SCHOOL_NAME, options = {}) {
  const normalizedSchoolId = String(schoolId || DEFAULT_SCHOOL_ID).trim() || DEFAULT_SCHOOL_ID;
  const cached = getWeatherCache(normalizedSchoolId);

  if (!options.force && cached) {
    return Promise.resolve(cached);
  }

  if (!options.force && store.loadingBySchool[normalizedSchoolId]) {
    return store.loadingBySchool[normalizedSchoolId];
  }

  store.loadingBySchool[normalizedSchoolId] = callGetSchedule({
    action: 'weather',
    schoolId: normalizedSchoolId
  }, '\u5929\u6c14\u52a0\u8f7d\u5931\u8d25')
    .then((data) => setWeatherCache(normalizedSchoolId, data) || data)
    .catch(() => {
      const stale = getWeatherCache(normalizedSchoolId, { allowStale: true });

      if (stale) {
        return stale;
      }

      return {
        schoolId: normalizedSchoolId,
        schoolName,
        displayText: getFallbackText(schoolName),
        unavailable: true,
        cachedAt: new Date(Date.now()).toISOString()
      };
    })
    .finally(() => {
      delete store.loadingBySchool[normalizedSchoolId];
    });

  return store.loadingBySchool[normalizedSchoolId];
}

function preloadWeatherForSchedule(schedule, options = {}) {
  if (!schedule) {
    return Promise.resolve(null);
  }

  return loadWeatherForSchool(
    getSchoolIdFromSchedule(schedule),
    getSchoolNameFromSchedule(schedule),
    options
  );
}

function getWeatherDisplayText(schedule) {
  const schoolId = getSchoolIdFromSchedule(schedule);
  const schoolName = getSchoolNameFromSchedule(schedule);
  const cached = getWeatherCache(schoolId, { allowStale: true });

  return cached && cached.displayText ? cached.displayText : getFallbackText(schoolName);
}

function clearWeatherCache() {
  store.weatherBySchool = {};
  store.loadingBySchool = {};

  try {
    wx.removeStorageSync(WEATHER_CACHE_KEY);
  } catch (error) {}
}

module.exports = {
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_TTL_MS,
  clearWeatherCache,
  getFallbackText,
  getSchoolIdFromSchedule,
  getWeatherCache,
  getWeatherDisplayText,
  loadWeatherForSchool,
  preloadWeatherForSchedule,
  setWeatherCache
};
