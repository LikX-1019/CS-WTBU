const { callGetSchedule } = require('../../utils/api');
const { resetBindingState } = require('../../utils/auth');
const { clearAll } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');

const CACHE_KEYS = [
  { key: 'scheduleData', label: '课表' },
  { key: 'gradesData', label: '成绩' },
  { key: 'profileData', label: '个人资料' }
];

function hasStorage(key) {
  try {
    return Boolean(wx.getStorageSync(key));
  } catch (error) {
    return false;
  }
}

function getCacheText() {
  const labels = CACHE_KEYS
    .filter((item) => hasStorage(item.key))
    .map((item) => item.label);

  return labels.length > 0 ? `已缓存：${labels.join('、')}` : '暂无本机缓存';
}

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    cacheEnabled: true,
    cacheText: getCacheText(),
    unbinding: false
  }),

  onShow() {
    this.refreshCacheText();
  },

  refreshCacheText() {
    this.setData({
      cacheText: getCacheText()
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

  clearLocalCache() {
    clearAll();
    resetBindingState();
    this.refreshCacheText();
    wx.showToast({
      title: '缓存已清理',
      icon: 'success'
    });
  },

  rebindAccount() {
    clearAll();
    resetBindingState();
    wx.reLaunch({
      url: '/pages/login/index'
    });
  },

  unbindAccount() {
    if (this.data.unbinding) {
      return;
    }

    wx.showModal({
      title: '解除绑定',
      content: '确定删除当前微信的教务账号绑定吗？',
      confirmColor: '#e11d48',
      success: async (result) => {
        if (!result.confirm) {
          return;
        }

        this.setData({ unbinding: true });

        try {
          await callGetSchedule({ action: 'unbind' }, '解绑失败');
          clearAll();
          resetBindingState();
          wx.reLaunch({
            url: '/pages/login/index'
          });
        } catch (error) {
          wx.showToast({
            title: error.messageText || error.message || '解绑失败',
            icon: 'none'
          });
        } finally {
          this.setData({ unbinding: false });
        }
      }
    });
  }
});
