const DEFAULT_SHARE_TITLE = '\u6211\u7684\u8bfe\u7a0b\u8868';
const DEFAULT_SHARE_PATH = '/pages/home/index';
const SHARE_MENUS = ['shareAppMessage', 'shareTimeline'];

function normalizeShareOptions(options = {}) {
  return {
    title: options.title || DEFAULT_SHARE_TITLE,
    path: options.path || DEFAULT_SHARE_PATH,
    imageUrl: options.imageUrl || '',
    query: options.query || ''
  };
}

function enableShareMenu() {
  if (typeof wx === 'undefined' || typeof wx.showShareMenu !== 'function') {
    return;
  }

  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: SHARE_MENUS
    });
  } catch (error) {
    try {
      wx.showShareMenu({
        withShareTicket: true
      });
    } catch (fallbackError) {}
  }
}

function buildShareAppMessage(options = {}) {
  const shareOptions = normalizeShareOptions(options);
  const message = {
    title: shareOptions.title,
    path: shareOptions.path
  };

  if (shareOptions.imageUrl) {
    message.imageUrl = shareOptions.imageUrl;
  }

  return message;
}

function buildShareTimeline(options = {}) {
  const shareOptions = normalizeShareOptions(options);
  const message = {
    title: shareOptions.title
  };

  if (shareOptions.imageUrl) {
    message.imageUrl = shareOptions.imageUrl;
  }

  if (shareOptions.query) {
    message.query = shareOptions.query;
  }

  return message;
}

function withShare(pageConfig, options = {}) {
  const originalOnShow = pageConfig && pageConfig.onShow;
  const originalShareAppMessage = pageConfig && pageConfig.onShareAppMessage;
  const originalShareTimeline = pageConfig && pageConfig.onShareTimeline;

  return Object.assign({}, pageConfig, {
    onShow(...args) {
      enableShareMenu();

      if (typeof originalOnShow === 'function') {
        return originalOnShow.apply(this, args);
      }

      return undefined;
    },

    onShareAppMessage(event) {
      if (typeof originalShareAppMessage === 'function') {
        return originalShareAppMessage.call(this, event);
      }

      return buildShareAppMessage(options);
    },

    onShareTimeline(event) {
      if (typeof originalShareTimeline === 'function') {
        return originalShareTimeline.call(this, event);
      }

      return buildShareTimeline(options);
    }
  });
}

module.exports = {
  DEFAULT_SHARE_PATH,
  DEFAULT_SHARE_TITLE,
  SHARE_MENUS,
  enableShareMenu,
  buildShareAppMessage,
  buildShareTimeline,
  withShare
};
