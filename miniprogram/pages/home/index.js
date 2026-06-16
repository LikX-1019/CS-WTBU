const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadCurrentSchedule } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');
const {
  formatFetchTime,
  formatWeekText,
  getTodayScheduleItems,
  getTodayText
} = require('../../utils/schedule');

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    today: getTodayText(),
    weekText: '',
    items: [],
    loading: false,
    errorText: '',
    cacheWarningText: '',
    lastFetchedText: ''
  }),

  onShow() {
    this.loadSchedule();
  },

  onPullDownRefresh() {
    this.loadSchedule({ force: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadSchedule(options = {}) {
    if (this.data.loading) {
      return;
    }

    this.setData({
      loading: true,
      errorText: '',
      today: getTodayText()
    });

    try {
      await ensureBound();
      const data = await loadCurrentSchedule({
        force: Boolean(options.force)
      });
      const fetchedTime = new Date(data.lastFetchedAt || '').getTime();
      const cacheWarningText = Number.isFinite(fetchedTime) && fetchedTime > 0 && Date.now() - fetchedTime > 48 * 60 * 60 * 1000
        ? '课表数据已超过48小时，建议到个人页更新数据库。'
        : '';

      this.setData({
        weekText: formatWeekText(data.term, undefined, data.termStartDate),
        items: getTodayScheduleItems(data.courses, data.exams, data.termStartDate),
        cacheWarningText,
        lastFetchedText: formatFetchTime(data.lastFetchedAt)
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      this.setData({
        errorText: error.messageText || error.message || '课表加载失败'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  goHome() {
    goTab('home');
  },

  goSchedule() {
    goTab('schedule');
  },

  goGrades() {
    goTab('grades');
  },

  goProfile() {
    goTab('profile');
  }
});
