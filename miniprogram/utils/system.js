function getWindowInfo() {
  if (wx.getWindowInfo) {
    return wx.getWindowInfo();
  }

  return wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
}

function getCustomNavStyle() {
  const windowInfo = getWindowInfo();
  const statusBarHeight = Number(windowInfo.statusBarHeight) || 24;
  let contentHeight = 44;

  if (wx.getMenuButtonBoundingClientRect) {
    try {
      const menuRect = wx.getMenuButtonBoundingClientRect();
      const gap = Math.max(menuRect.top - statusBarHeight, 4);

      contentHeight = menuRect.height + gap * 2;
    } catch (error) {
      contentHeight = 44;
    }
  }

  return {
    navStyle: `height: ${statusBarHeight + contentHeight}px; padding-top: ${statusBarHeight}px;`
  };
}

module.exports = {
  getCustomNavStyle
};
