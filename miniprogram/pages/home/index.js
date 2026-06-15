const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadSchedule } = require('../../utils/dataStore');
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
      const data = await loadSchedule(options);

      this.setData({
        weekText: formatWeekText(data.term, undefined, data.termStartDate),
        items: getTodayScheduleItems(data.courses, data.exams, data.termStartDate),
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
