const { callGetSchedule } = require('../../utils/api');
const { getCustomNavStyle } = require('../../utils/system');

const TABS = [
  { key: 'users', label: '用户' },
  { key: 'feedback', label: '反馈' }
];

const STATUS_OPTIONS = [
  { status: 'pending', label: '待处理' },
  { status: 'processing', label: '处理中' },
  { status: 'resolved', label: '已解决' },
  { status: 'closed', label: '已关闭' }
];

function getStatusLabel(status) {
  const option = STATUS_OPTIONS.find((item) => item.status === status);

  return option ? option.label : STATUS_OPTIONS[0].label;
}

function getStatusIndex(status) {
  const index = STATUS_OPTIONS.findIndex((item) => item.status === status);

  return index >= 0 ? index : 0;
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
    loading: false,
    errorText: '',
    adminText: '',
    updatingId: '',
    statusOptions: STATUS_OPTIONS.map((item) => item.label)
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
