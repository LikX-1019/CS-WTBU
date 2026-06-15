const { callGetSchedule } = require('./api');

const CACHE_SCHEMA_VERSION = 2;

const store = {
  schedule: null,
  profile: null,
  grades: null,
  termWeek: null,
  loadingSchedule: null,
  loadingProfile: null,
  loadingGrades: null,
  loadingTermWeek: null,
  sessionScheduleLoaded: false,
  sessionGradesLoaded: false
};

function getTermWeekCacheKey(schoolId, semesterId) {
  return `${String(schoolId || '').trim()}::${String(semesterId || '').trim()}`;
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

function getScheduleCache() {
  if (isCurrentCache(store.schedule)) {
    return store.schedule;
  }

  try {
    const cached = wx.getStorageSync('scheduleData') || null;

    return isCurrentCache(cached) ? cached : null;
  } catch (error) {
    return null;
  }
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

async function loadSchedule(options = {}) {
  if (!options.force) {
    const cached = store.sessionScheduleLoaded ? getScheduleCache() : null;

    if (cached) {
      const data = await loadScheduleWithTermWeek(cached, {
        force: true,
        semesterId: options.semesterId || cached.selectedSemesterId
      });

      store.schedule = data;
      wx.setStorageSync('scheduleData', data);
      return data;
    }

    if (store.loadingSchedule) {
      return store.loadingSchedule;
    }
  }

  const requestData = { action: 'refresh' };

  if (options.semesterId) {
    requestData.semesterId = options.semesterId;
  }

  if (options.force) {
    requestData.force = true;
  }

  store.loadingSchedule = callGetSchedule(requestData, '课表加载失败')
    .then((data) => {
      return loadScheduleWithTermWeek(data, {
        force: Boolean(options.force),
        semesterId: requestData.semesterId
      });
    })
    .then((data) => {
      store.schedule = data;
      store.sessionScheduleLoaded = true;
      wx.setStorageSync('scheduleData', data);
      return data;
    })
    .finally(() => {
      store.loadingSchedule = null;
    });

  return store.loadingSchedule;
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

  const requestData = { action: 'grades' };

  if (options.force) {
    requestData.force = true;
  }

  store.loadingGrades = callGetSchedule(requestData, '成绩加载失败')
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

async function submitTermWeekReport(schedule, report) {
  const meta = getScheduleTermWeekMeta(schedule);
  const data = await callGetSchedule({
    action: 'submitTermWeekReport',
    schoolId: meta.schoolId,
    semesterId: meta.semesterId,
    term: meta.term,
    weekNumber: report && report.weekNumber,
    weekMondayDate: report && report.weekMondayDate
  }, '学期起始周上报失败');
  const normalized = normalizeTermWeekData(data);

  store.termWeek = normalized;
  store.termWeekCacheKey = getTermWeekCacheKey(meta.schoolId, meta.semesterId);

  if (store.schedule) {
    store.schedule = applyTermWeekToSchedule(store.schedule, normalized);
    wx.setStorageSync('scheduleData', store.schedule);
  }

  return normalized;
}

async function refreshEduCache() {
  const data = await callGetSchedule({ action: 'refreshAll' }, '教务系统更新失败');

  if (data.schedule) {
    setSchedule(data.schedule);
  }

  if (data.grades) {
    setGrades(data.grades);
  }

  return data;
}

function setSchedule(data) {
  store.schedule = data || null;

  if (data) {
    store.sessionScheduleLoaded = true;
    wx.setStorageSync('scheduleData', data);
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
  store.profile = null;
  store.grades = null;
  store.termWeek = null;
  store.loadingSchedule = null;
  store.loadingProfile = null;
  store.loadingGrades = null;
  store.loadingTermWeek = null;
  store.loadingTermWeekKey = '';
  store.termWeekCacheKey = '';
  store.sessionScheduleLoaded = false;
  store.sessionGradesLoaded = false;
  wx.removeStorageSync('scheduleData');
  wx.removeStorageSync('profileData');
  wx.removeStorageSync('gradesData');
}

module.exports = {
  clearAll,
  getGradesCache,
  getProfileCache,
  getScheduleCache,
  loadGrades,
  loadProfile,
  loadSchedule,
  loadTermWeekConfig,
  refreshEduCache,
  saveProfile,
  submitTermWeekReport,
  setGrades,
  setProfile,
  setSchedule
};
