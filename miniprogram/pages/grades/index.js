const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadGrades } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');

const EMPTY_SUMMARY = [
  { label: '总学分', value: '--' },
  { label: '平均分', value: '--' },
  { label: '绩点', value: '--' }
];

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    summary: EMPTY_SUMMARY,
    semesters: [],
    loading: false,
    errorText: '',
    emptyText: '暂无成绩数据'
  }),

  onShow() {
    this.loadGrades();
  },

  onPullDownRefresh() {
    this.loadGrades({ force: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadGrades(options = {}) {
    if (this.data.loading) {
      return;
    }

    this.setData({
      loading: true,
      errorText: ''
    });

    try {
      await ensureBound();
      const data = await loadGrades(options);

      this.setData({
        summary: Array.isArray(data.summary) ? data.summary : EMPTY_SUMMARY,
        semesters: Array.isArray(data.semesters) ? data.semesters : []
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      this.setData({
        errorText: error.messageText || error.message || '成绩加载失败'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleSemester(event) {
    const index = Number(event.currentTarget.dataset.index);
    const semesters = this.data.semesters.map((semester, itemIndex) => {
      if (itemIndex !== index) {
        return semester;
      }

      return Object.assign({}, semester, {
        expanded: !semester.expanded
      });
    });

    this.setData({ semesters });
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
