const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadCurrentSchedule } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');
const { withShare } = require('../../utils/share');
const { getWeatherDisplayText, preloadWeatherForSchedule } = require('../../utils/weather');
const {
  formatFetchTime,
  getTodayScheduleItems,
  getTodayText
} = require('../../utils/schedule');

Page(withShare({
  data: Object.assign({}, getCustomNavStyle(), {
    today: getTodayText(),
    items: [],
    loading: false,
    errorText: '',
    lastFetchedText: '',
    weatherText: ''
  }),

  onShow() {
    this.loadSchedule();
  },

  onPullDownRefresh() {
    this.loadSchedule().finally(() => {
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
      const data = await loadCurrentSchedule();
      const lastFetchedText = formatFetchTime(data.lastFetchedAt);

      this.setData({
        items: getTodayScheduleItems(data.courses, data.exams, data.termStartDate),
        lastFetchedText: lastFetchedText ? `${lastFetchedText} \u66f4\u65b0` : '',
        weatherText: getWeatherDisplayText(data)
      });

      this.loadWeather(data);
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

  loadWeather(schedule) {
    preloadWeatherForSchedule(schedule)
      .then((weather) => {
        this.setData({
          weatherText: weather && weather.displayText ? weather.displayText : getWeatherDisplayText(schedule)
        });
      })
      .catch(() => {
        this.setData({
          weatherText: getWeatherDisplayText(schedule)
        });
      });
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
}));
