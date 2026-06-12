const TAB_ROUTES = {
  home: '/pages/home/index',
  schedule: '/pages/schedule/index',
  grades: '/pages/grades/index',
  profile: '/pages/profile/index'
};

function goTab(key) {
  const url = TAB_ROUTES[key];

  if (!url) {
    return;
  }

  wx.redirectTo({ url });
}

module.exports = {
  goTab
};
