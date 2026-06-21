const { getCustomNavStyle } = require('../../utils/system');
const { withShare } = require('../../utils/share');

Page(withShare({
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
}));
