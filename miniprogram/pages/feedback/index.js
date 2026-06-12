const { getCustomNavStyle } = require('../../utils/system');

const STORAGE_KEY = 'feedbackHistory';

function formatDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${month}-${day} ${hour}:${minute}`;
}

function loadHistory() {
  try {
    const history = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(history) ? history : [];
  } catch (error) {
    return [];
  }
}

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    typeOptions: ['功能异常', '数据问题', '体验建议'],
    typeIndex: 0,
    typeText: '功能异常',
    content: '',
    contentLength: 0,
    contact: '',
    history: loadHistory()
  }),

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

    wx.redirectTo({
      url: '/pages/profile/index'
    });
  },

  onTypeChange(event) {
    const typeIndex = Number(event.detail.value) || 0;

    this.setData({
      typeIndex,
      typeText: this.data.typeOptions[typeIndex] || this.data.typeOptions[0]
    });
  },

  onContentInput(event) {
    const content = event.detail.value;

    this.setData({
      content,
      contentLength: content.length
    });
  },

  onContactInput(event) {
    this.setData({
      contact: event.detail.value
    });
  },

  submitFeedback() {
    const content = this.data.content.trim();

    if (!content) {
      wx.showToast({
        title: '请填写反馈内容',
        icon: 'none'
      });
      return;
    }

    const now = new Date();
    const item = {
      type: this.data.typeOptions[this.data.typeIndex],
      content,
      contact: this.data.contact.trim(),
      createdAt: now.toISOString(),
      dateText: formatDate(now)
    };
    const history = [item, ...this.data.history].slice(0, 5);

    wx.setStorageSync(STORAGE_KEY, history);
    this.setData({
      content: '',
      contentLength: 0,
      contact: '',
      history
    });
    wx.showToast({
      title: '已提交',
      icon: 'success'
    });
  }
});
