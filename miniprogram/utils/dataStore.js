const { callGetSchedule } = require('./api');

const CACHE_SCHEMA_VERSION = 3;
const SCHEDULE_CACHE_MAP_KEY = 'scheduleDataBySemester';

const store = {
  schedule: null,
  currentSchedule: null,
  scheduleBySemester: {},
  profile: null,
  grades: null,
  termWeek: null,
  termWeekCacheKey: '',
  loadingSchedule: null,
  loadingScheduleKey: '',
  loadingProfile: null,
  loadingGrades: null,
  loadingTermWeek: null,
  loadingTermWeekKey: '',
  sessionScheduleLoaded: false,
  sessionGradesLoaded: false
};

function getTermWeekCacheKey(schoolId, semesterId) {
  return `${String(schoolId || '').trim()}::${String(semesterId || '').trim()}`;
}

function getScheduleCacheKey(semesterId) {
  const value = String(semesterId || '').trim();
  return value || 'current';
}

function normalizeTermWeekData(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const config = data.config || null;

  return Object.assign({}, data, {
    config,
    report: data.report || null,
    progress: data.progress || null,
    termStartDate: config && config.termStartDate ? String(config.termStartDate) : '',
    canSubmitReport: Boolean(data.canSubmitReport)
  });
}

function getScheduleTermWeekMeta(schedule, options = {}) {
  const source = schedule || {};
  const school = source.school || {};

  return {
    schoolId: String(options.schoolId || school.id || source.schoolId || '').trim(),
    semesterId: String(options.semesterId || source.selectedSemesterId || '').trim(),
    term: String(options.term || source.term || '').trim()
  };
}

function applyTermWeekToSchedule(schedule, termWeek) {
  const data = Object.assign({}, schedule || {});
  const normalized = normalizeTermWeekData(termWeek);
  const termStartDate = normalized && normalized.termStartDate ? normalized.termStartDate : '';

  data.termWeek = normalized;
  data.termWeekConfig = normalized ? normalized.config : null;
  data.termWeekReport = normalized ? normalized.report : null;
  data.termWeekProgress = normalized ? normalized.progress : null;
  data.canSubmitTermWeekReport = normalized ? normalized.canSubmitReport : false;
  data.termStartDate = termStartDate;

  return data;
}

async function loadTermWeekConfig(schedule, options = {}) {
  const meta = getScheduleTermWeekMeta(schedule, options);

  if (!meta.schoolId || !meta.semesterId) {
    return null;
  }

  const cacheKey = getTermWeekCacheKey(meta.schoolId, meta.semesterId);

  if (!options.force && store.termWeek && store.termWeekCacheKey === cacheKey) {
    return store.termWeek;
  }

  if (!options.force && store.loadingTermWeek && store.loadingTermWeekKey === cacheKey) {
    return store.loadingTermWeek;
  }

  store.loadingTermWeekKey = cacheKey;
  store.loadingTermWeek = callGetSchedule({
    action: 'getTermWeekConfig',
    schoolId: meta.schoolId,
    semesterId: meta.semesterId,
    term: meta.term
  }, '学期起始周配置加载失败')
    .then((data) => {
      const normalized = normalizeTermWeekData(data);

      store.termWeek = normalized;
      store.termWeekCacheKey = cacheKey;

      return normalized;
    })
    .finally(() => {
      store.loadingTermWeek = null;
      store.loadingTermWeekKey = '';
    });

  return store.loadingTermWeek;
}

async function loadScheduleWithTermWeek(schedule, options = {}) {
  const termWeek = await loadTermWeekConfig(schedule, options);
  return applyTermWeekToSchedule(schedule, termWeek);
}

function isCurrentCache(data) {
  return data && Number(data.cacheVersion) === CACHE_SCHEMA_VERSION;
}

function normalizeScheduleCacheMap(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }

  const result = {};

  Object.keys(data).forEach((key) => {
    if (isCurrentCache(data[key])) {
      result[key] = data[key];
    }
  });

  return result;
}

function getStoredScheduleCacheMap() {
  if (store.scheduleBySemester && Object.keys(store.scheduleBySemester).length > 0) {
    return store.scheduleBySemester;
  }

  try {
    const cached = wx.getStorageSync(SCHEDULE_CACHE_MAP_KEY) || null;
    const normalized = normalizeScheduleCacheMap(cached);

    if (Object.keys(normalized).length > 0) {
      store.scheduleBySemester = normalized;
      return normalized;
    }
  } catch (error) {
    return {};
  }

  return {};
}

function setStoredScheduleCacheMap(cacheMap) {
  const normalized = normalizeScheduleCacheMap(cacheMap);
  store.scheduleBySemester = normalized;
  wx.setStorageSync(SCHEDULE_CACHE_MAP_KEY, normalized);
}

function persistScheduleToMap(data) {
  if (!isCurrentCache(data)) {
    return;
  }

  const semesterId = String(data.selectedSemesterId || '').trim();

  if (!semesterId) {
    return;
  }

  const cacheMap = getStoredScheduleCacheMap();
  cacheMap[getScheduleCacheKey(semesterId)] = data;
  setStoredScheduleCacheMap(cacheMap);
}

function migrateLegacyScheduleCache(legacyCache) {
  if (!isCurrentCache(legacyCache)) {
    return null;
  }

  persistScheduleToMap(legacyCache);
  return legacyCache;
}

function getScheduleCache() {
  if (isCurrentCache(store.schedule)) {
    return store.schedule;
  }

  const currentSemesterId = String(
    store.currentSchedule && store.currentSchedule.selectedSemesterId || ''
  ).trim();

  if (currentSemesterId) {
    const mapped = getSemesterScheduleCache(currentSemesterId);

    if (mapped) {
      return mapped;
    }
  }

  try {
    const cached = wx.getStorageSync('scheduleData') || null;
    return migrateLegacyScheduleCache(cached);
  } catch (error) {
    return null;
  }
}

function getCurrentScheduleCache() {
  if (isCurrentCache(store.currentSchedule)) {
    return store.currentSchedule;
  }

  try {
    const cached = wx.getStorageSync('currentScheduleData') || null;
    return isCurrentCache(cached) ? cached : null;
  } catch (error) {
    return null;
  }
}

function getSemesterScheduleCache(semesterId) {
  const normalizedSemesterId = String(semesterId || '').trim();

  if (!normalizedSemesterId) {
    return null;
  }

  const key = getScheduleCacheKey(normalizedSemesterId);

  if (isCurrentCache(store.scheduleBySemester[key])) {
    return store.scheduleBySemester[key];
  }

  const cacheMap = getStoredScheduleCacheMap();

  if (isCurrentCache(cacheMap[key])) {
    return cacheMap[key];
  }

  try {
    const legacyCache = wx.getStorageSync('scheduleData') || null;

    if (isCurrentCache(legacyCache) && String(legacyCache.selectedSemesterId || '').trim() === normalizedSemesterId) {
      persistScheduleToMap(legacyCache);
      return legacyCache;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function getGradesCache() {
  if (isCurrentCache(store.grades)) {
    return store.grades;
  }

  try {
    const cached = wx.getStorageSync('gradesData') || null;
    return isCurrentCache(cached) ? cached : null;
  } catch (error) {
    return null;
  }
}

function getProfileCache() {
  if (store.profile) {
    return store.profile;
  }

  try {
    return wx.getStorageSync('profileData') || null;
  } catch (error) {
    return null;
  }
}

function persistSchedule(data, options = {}) {
  if (!data) {
    return;
  }

  store.sessionScheduleLoaded = true;

  if (options.currentSemesterOnly) {
    store.currentSchedule = data;
    wx.setStorageSync('currentScheduleData', data);
  } else {
    store.schedule = data;
    wx.setStorageSync('scheduleData', data);
  }

  persistScheduleToMap(data);
}

async function loadSchedule(options = {}) {
  const useCurrentSemester = Boolean(options.currentSemesterOnly);
  const requestedSemesterId = String(options.semesterId || '').trim();
  const readMode = options.force ? 'force' : (options.fromDatabase ? 'db' : 'read');
  const loadingKey = `${useCurrentSemester ? 'current' : 'schedule'}::${requestedSemesterId || 'default'}::${readMode}`;

  if (!options.force && !options.fromDatabase) {
    const cached = store.sessionScheduleLoaded
      ? (
        useCurrentSemester
          ? getCurrentScheduleCache()
          : (requestedSemesterId ? getSemesterScheduleCache(requestedSemesterId) : getScheduleCache())
      )
      : null;

    if (cached && (!requestedSemesterId || requestedSemesterId === cached.selectedSemesterId)) {
      const data = await loadScheduleWithTermWeek(cached, {
        force: true,
        semesterId: cached.selectedSemesterId
      });

      persistSchedule(data, {
        currentSemesterOnly: useCurrentSemester
      });

      return data;
    }

    if (store.loadingSchedule && store.loadingScheduleKey === loadingKey) {
      return store.loadingSchedule;
    }
  }

  const requestData = options.force ? { action: 'refresh' } : {};

  if (requestedSemesterId) {
    requestData.semesterId = requestedSemesterId;
  }

  store.loadingScheduleKey = loadingKey;
  store.loadingSchedule = callGetSchedule(requestData, '课表加载失败')
    .then((data) => {
      return loadScheduleWithTermWeek(data, {
        force: Boolean(options.force),
        semesterId: requestedSemesterId
      });
    })
    .then((data) => {
      persistSchedule(data, {
        currentSemesterOnly: useCurrentSemester
      });

      return data;
    })
    .finally(() => {
      store.loadingSchedule = null;
      store.loadingScheduleKey = '';
    });

  return store.loadingSchedule;
}

async function loadCurrentSchedule(options = {}) {
  return loadSchedule({
    ...options,
    currentSemesterOnly: true
  });
}

async function loadGrades(options = {}) {
  if (!options.force) {
    const cached = store.sessionGradesLoaded ? getGradesCache() : null;

    if (cached) {
      store.grades = cached;
      return cached;
    }

    if (store.loadingGrades) {
      return store.loadingGrades;
    }
  }

  store.loadingGrades = callGetSchedule({ action: 'grades' }, '成绩加载失败')
    .then((data) => {
      store.grades = data;
      store.sessionGradesLoaded = true;
      wx.setStorageSync('gradesData', data);
      return data;
    })
    .finally(() => {
      store.loadingGrades = null;
    });

  return store.loadingGrades;
}

async function loadProfile(options = {}) {
  if (!options.force) {
    const cached = getProfileCache();

    if (cached) {
      store.profile = cached;
      return cached;
    }

    if (store.loadingProfile) {
      return store.loadingProfile;
    }
  }

  store.loadingProfile = callGetSchedule({ action: 'profile' }, '个人信息加载失败')
    .then((data) => {
      store.profile = data;
      wx.setStorageSync('profileData', data);
      return data;
    })
    .finally(() => {
      store.loadingProfile = null;
    });

  return store.loadingProfile;
}

async function saveProfile(profile) {
  const data = await callGetSchedule({
    action: 'saveProfile',
    profile: profile || {}
  }, '个人信息保存失败');

  setProfile(data);
  return data;
}

async function refreshEduCache() {
  const data = await callGetSchedule({ action: 'refreshAll' }, '教务系统更新失败');

  if (data.schedule) {
    const schedule = await loadScheduleWithTermWeek(data.schedule, {
      force: true,
      semesterId: data.schedule.selectedSemesterId
    });

    setSchedule(schedule);
    setCurrentSchedule(schedule);
    data.schedule = schedule;
  }

  if (data.grades) {
    setGrades(data.grades);
  }

  return data;
}

function setSchedule(data) {
  store.schedule = data || null;

  if (data) {
    persistSchedule(data, {
      currentSemesterOnly: false
    });
  }
}

function setCurrentSchedule(data) {
  store.currentSchedule = data || null;

  if (data) {
    persistSchedule(data, {
      currentSemesterOnly: true
    });
  }
}

function setGrades(data) {
  store.grades = data || null;

  if (data) {
    store.sessionGradesLoaded = true;
    wx.setStorageSync('gradesData', data);
  }
}

function setProfile(data) {
  store.profile = data || null;

  if (data) {
    wx.setStorageSync('profileData', data);
  }
}

function clearAll() {
  store.schedule = null;
  store.currentSchedule = null;
  store.scheduleBySemester = {};
  store.profile = null;
  store.grades = null;
  store.termWeek = null;
  store.termWeekCacheKey = '';
  store.loadingSchedule = null;
  store.loadingScheduleKey = '';
  store.loadingProfile = null;
  store.loadingGrades = null;
  store.loadingTermWeek = null;
  store.loadingTermWeekKey = '';
  store.sessionScheduleLoaded = false;
  store.sessionGradesLoaded = false;
  wx.removeStorageSync('scheduleData');
  wx.removeStorageSync(SCHEDULE_CACHE_MAP_KEY);
  wx.removeStorageSync('currentScheduleData');
  wx.removeStorageSync('profileData');
  wx.removeStorageSync('gradesData');
}

module.exports = {
  clearAll,
  getCurrentScheduleCache,
  getGradesCache,
  getProfileCache,
  getSemesterScheduleCache,
  getScheduleCache,
  loadCurrentSchedule,
  loadGrades,
  loadProfile,
  loadSchedule,
  loadTermWeekConfig,
  refreshEduCache,
  saveProfile,
  setCurrentSchedule,
  setGrades,
  setProfile,
  setSchedule
};
