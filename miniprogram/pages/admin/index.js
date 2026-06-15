const { callGetSchedule } = require('../../utils/api');
const { getCustomNavStyle } = require('../../utils/system');

const TABS = [
  { key: 'users', label: '用户' },
  { key: 'feedback', label: '反馈' },
  { key: 'campus', label: '校园' }
];

const STATUS_OPTIONS = [
  { status: 'pending', label: '待处理' },
  { status: 'processing', label: '处理中' },
  { status: 'resolved', label: '已解决' },
  { status: 'closed', label: '已关闭' }
];
const WEEK_OPTIONS = Array.from({ length: 20 }, (_, index) => `第${index + 1}周`);

function getStatusLabel(status) {
  const option = STATUS_OPTIONS.find((item) => item.status === status);

  return option ? option.label : STATUS_OPTIONS[0].label;
}

function getStatusIndex(status) {
  const index = STATUS_OPTIONS.findIndex((item) => item.status === status);

  return index >= 0 ? index : 0;
}

function formatDateInput(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay();
  const offset = day === 0 ? -6 : 1 - day;

  value.setDate(value.getDate() + offset);

  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('-');
}

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    tabs: TABS,
    activeTab: 'users',
    stats: [
      { key: 'users', label: '绑定用户', value: '--' },
      { key: 'feedback', label: '反馈总数', value: '--' },
      { key: 'pending', label: '待处理', value: '--' }
    ],
    users: [],
    feedback: [],
    schools: [],
    termWeekItems: [],
    termWeekSummary: null,
    campusLoading: false,
    savingTermWeek: false,
    configSchoolId: '',
    configSchoolIndex: 0,
    configSchoolName: '',
    configSemesterId: '',
    configTerm: '',
    configWeekNumber: 1,
    configWeekIndex: 0,
    configWeekMondayDate: formatDateInput(),
    loading: false,
    errorText: '',
    adminText: '',
    updatingId: '',
    statusOptions: STATUS_OPTIONS.map((item) => item.label),
    weekOptions: WEEK_OPTIONS
  }),

  onLoad() {
    this.loadDashboard();
  },

  onPullDownRefresh() {
    this.loadDashboard({ silent: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

    wx.redirectTo({
      url: '/pages/profile/index'
    });
  },

  switchTab(event) {
    const key = event.currentTarget.dataset.key;

    if (!key || key === this.data.activeTab) {
      return;
    }

    this.setData({
      activeTab: key
    });
  },

  async loadDashboard(options = {}) {
    if (this.data.loading) {
      return;
    }

    this.setData({
      loading: true,
      errorText: options.silent ? this.data.errorText : ''
    });

    try {
      const data = await callGetSchedule({
        action: 'adminDashboard',
        limit: 50
      }, '管理员数据加载失败');

      this.setData({
        stats: Array.isArray(data.stats) ? data.stats : this.data.stats,
        users: Array.isArray(data.users) ? data.users : [],
        feedback: Array.isArray(data.feedback) ? data.feedback : [],
        adminText: data.admin && data.admin.openidText ? `管理员 ${data.admin.openidText}` : '',
        errorText: ''
      });
      await this.loadTermWeekItems();
    } catch (error) {
      this.setData({
        errorText: error.code === 'FORBIDDEN'
          ? '当前微信暂无管理员权限，请在云函数环境变量 ADMIN_OPENIDS 中加入你的 OpenID。'
          : error.messageText || error.message || '管理员数据加载失败'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  refreshDashboard() {
    this.loadDashboard({ silent: true });
  },

  async loadTermWeekItems() {
    if (this.termWeekLoadingPromise) {
      return this.termWeekLoadingPromise;
    }

    this.setData({ campusLoading: true });

    this.termWeekLoadingPromise = callGetSchedule({
      action: 'adminListTermWeekConfigs'
    }, '学期周配置加载失败')
      .then((data) => {
        const schools = Array.isArray(data.schools) ? data.schools : [];
        const items = Array.isArray(data.items) ? data.items : [];
        const selectedSchool = schools.find((school) => school.id === this.data.configSchoolId) || schools[0] || null;
        const selectedSchoolIndex = selectedSchool ? schools.findIndex((school) => school.id === selectedSchool.id) : 0;

        this.setData({
          schools,
          termWeekItems: items,
          termWeekSummary: data.summary || null,
          configSchoolId: selectedSchool ? selectedSchool.id : '',
          configSchoolIndex: selectedSchoolIndex >= 0 ? selectedSchoolIndex : 0,
          configSchoolName: selectedSchool ? selectedSchool.name : '',
          errorText: ''
        });
        return data;
      })
      .catch((error) => {
        wx.showToast({
          title: error.messageText || error.message || '学期周配置加载失败',
          icon: 'none'
        });
        return null;
      })
      .finally(() => {
        this.termWeekLoadingPromise = null;
        this.setData({ campusLoading: false });
      });

    return this.termWeekLoadingPromise;
  },

  onConfigSchoolChange(event) {
    const index = Number(event.detail.value) || 0;
    const school = this.data.schools[index];

    if (!school) {
      return;
    }

    this.setData({
      configSchoolId: school.id,
      configSchoolIndex: index,
      configSchoolName: school.name
    });
  },

  onConfigSemesterInput(event) {
    this.setData({
      configSemesterId: event.detail.value.trim()
    });
  },

  onConfigTermInput(event) {
    this.setData({
      configTerm: event.detail.value.trim()
    });
  },

  onConfigWeekChange(event) {
    const configWeekNumber = Number(event.detail.value) + 1;

    this.setData({
      configWeekNumber,
      configWeekIndex: configWeekNumber - 1
    });
  },

  onConfigDateChange(event) {
    this.setData({
      configWeekMondayDate: event.detail.value
    });
  },

  async saveTermWeekConfig() {
    if (this.data.savingTermWeek) {
      return;
    }

    if (!this.data.configSchoolId || !this.data.configSemesterId) {
      wx.showToast({
        title: '请先选择学校和学期',
        icon: 'none'
      });
      return;
    }

    this.setData({ savingTermWeek: true });

    try {
      const data = await callGetSchedule({
        action: 'adminSaveTermWeekConfig',
        schoolId: this.data.configSchoolId,
        semesterId: this.data.configSemesterId,
        term: this.data.configTerm,
        weekNumber: this.data.configWeekNumber,
        weekMondayDate: this.data.configWeekMondayDate
      }, '保存学期周配置失败');

      await this.loadTermWeekItems();
      wx.showToast({
        title: data.config ? '已保存' : '保存成功',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error.messageText || error.message || '保存失败',
        icon: 'none'
      });
    } finally {
      this.setData({ savingTermWeek: false });
    }
  },

  onStatusChange(event) {
    const index = Number(event.detail.value) || 0;
    const feedbackId = event.currentTarget.dataset.id;
    const status = STATUS_OPTIONS[index] && STATUS_OPTIONS[index].status;

    if (!feedbackId || !status) {
      return;
    }

    this.updateFeedbackStatus(feedbackId, status);
  },

  async updateFeedbackStatus(feedbackId, status) {
    if (this.data.updatingId) {
      return;
    }

    this.setData({
      updatingId: feedbackId
    });

    try {
      const data = await callGetSchedule({
        action: 'adminUpdateFeedback',
        feedbackId,
        status
      }, '状态更新失败');
      const feedback = this.data.feedback.map((item) => {
        if (item.id !== feedbackId) {
          return item;
        }

        return Object.assign({}, item, {
          status: data.status || status,
          statusIndex: getStatusIndex(data.status || status),
          statusText: data.statusText || getStatusLabel(status)
        });
      });

      this.setData({ feedback });
      wx.showToast({
        title: '状态已更新',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error.messageText || error.message || '状态更新失败',
        icon: 'none'
      });
    } finally {
      this.setData({
        updatingId: ''
      });
    }
  }
});
