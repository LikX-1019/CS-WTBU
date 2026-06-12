const { getCustomNavStyle } = require('../../utils/system');

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    version: '1.0.0'
  }),

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }

    wx.redirectTo({
      url: '/pages/profile/index'
    });
  }
});
