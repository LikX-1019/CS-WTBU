const assert = require('assert');

const {
  DEFAULT_SHARE_PATH,
  DEFAULT_SHARE_TITLE,
  buildShareAppMessage,
  buildShareTimeline,
  enableShareMenu,
  withShare
} = require('./share');

let showShareMenuCalls = [];

global.wx = {
  showShareMenu(options) {
    showShareMenuCalls.push(options);
  }
};

enableShareMenu();

assert.strictEqual(showShareMenuCalls.length, 1);
assert.strictEqual(showShareMenuCalls[0].withShareTicket, true);
assert.deepStrictEqual(showShareMenuCalls[0].menus, ['shareAppMessage', 'shareTimeline']);

let onShowCalled = false;
const page = withShare({
  data: {
    studentId: '20260001',
    schedule: [{ name: 'private-course' }]
  },
  onShow(value) {
    onShowCalled = value === 'visible';
    return 'shown';
  }
});

showShareMenuCalls = [];
const onShowResult = page.onShow('visible');

assert.strictEqual(onShowResult, 'shown');
assert.strictEqual(onShowCalled, true);
assert.strictEqual(showShareMenuCalls.length, 1);

const appMessage = page.onShareAppMessage();

assert.strictEqual(appMessage.title, DEFAULT_SHARE_TITLE);
assert.strictEqual(appMessage.path, DEFAULT_SHARE_PATH);
assert.strictEqual(JSON.stringify(appMessage).includes('20260001'), false);
assert.strictEqual(JSON.stringify(appMessage).includes('private-course'), false);

const timelineMessage = page.onShareTimeline();

assert.strictEqual(timelineMessage.title, DEFAULT_SHARE_TITLE);
assert.strictEqual(Object.prototype.hasOwnProperty.call(timelineMessage, 'query'), false);
assert.strictEqual(JSON.stringify(timelineMessage).includes('20260001'), false);
assert.strictEqual(JSON.stringify(timelineMessage).includes('private-course'), false);

assert.deepStrictEqual(buildShareAppMessage({ title: 'Custom', path: '/pages/about/index' }), {
  title: 'Custom',
  path: '/pages/about/index'
});
assert.deepStrictEqual(buildShareTimeline({ title: 'Timeline' }), {
  title: 'Timeline'
});

global.wx = {};

assert.doesNotThrow(() => enableShareMenu());

let fallbackOptions = null;
global.wx = {
  showShareMenu(options) {
    if (options.menus) {
      throw new Error('menus unsupported');
    }

    fallbackOptions = options;
  }
};

assert.doesNotThrow(() => enableShareMenu());
assert.deepStrictEqual(fallbackOptions, {
  withShareTicket: true
});

global.wx = {
  showShareMenu() {
    throw new Error('showShareMenu failed');
  }
};

assert.doesNotThrow(() => enableShareMenu());

delete global.wx;

assert.doesNotThrow(() => enableShareMenu());

console.log('share tests passed');
