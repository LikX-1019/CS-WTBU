const { ensureBound } = require('./utils/auth');
const { loadCurrentSchedule, loadGrades } = require('./utils/dataStore');
const { preloadWeatherForSchedule } = require('./utils/weather');

App({
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '当前微信版本过低',
        content: '请升级微信后再使用云开发能力。',
        showCancel: false
      });
      return;
    }

    wx.cloud.init({
      env: 'cloud1-d5gf0kq778c3b68f2',
      traceUser: true
    });

    ensureBound()
      .then(() => loadCurrentSchedule())
      .then((schedule) => {
        preloadWeatherForSchedule(schedule).catch(() => {});
        return schedule;
      })
      .then(() => loadGrades())
      .catch(() => {});
  }
});
