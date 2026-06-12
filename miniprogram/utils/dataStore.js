const { callGetSchedule } = require('./api');

const store = {
  schedule: null,
  profile: null,
  grades: null,
  loadingSchedule: null,
  loadingProfile: null,
  loadingGrades: null,
  sessionScheduleLoaded: false,
  sessionGradesLoaded: false
};

function getScheduleCache() {
  if (store.schedule) {
    return store.schedule;
  }

  try {
    return wx.getStorageSync('scheduleData') || null;
  } catch (error) {
    return null;
  }
}

function getGradesCache() {
  if (store.grades) {
    return store.grades;
  }

  try {
    return wx.getStorageSync('gradesData') || null;
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
      store.schedule = cached;
      return cached;
    }

    if (store.loadingSchedule) {
      return store.loadingSchedule;
    }
  }

  const requestData = { action: 'refresh' };

  if (options.semesterId) {
    requestData.semesterId = options.semesterId;
  }

  store.loadingSchedule = callGetSchedule(requestData, '课表加载失败')
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
  store.loadingSchedule = null;
  store.loadingProfile = null;
  store.loadingGrades = null;
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
  saveProfile,
  setGrades,
  setProfile,
  setSchedule
};
