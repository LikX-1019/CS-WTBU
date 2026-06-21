const assert = require('assert');

let pageConfig = null;
let toastCalls = [];
let cloudHandler = null;
const storage = {};

global.Page = (config) => {
  pageConfig = config;
};

global.getCurrentPages = () => [];

global.wx = {
  getWindowInfo() {
    return { statusBarHeight: 0 };
  },
  getMenuButtonBoundingClientRect() {
    return { top: 0, bottom: 0, height: 0 };
  },
  showToast(options) {
    toastCalls.push(options);
  },
  switchTab() {},
  redirectTo() {},
  navigateTo() {},
  getStorageSync(key) {
    return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  stopPullDownRefresh() {},
  cloud: {
    callFunction({ data }) {
      return Promise.resolve({
        result: cloudHandler ? cloudHandler(data) : { success: true, data: {} }
      });
    }
  }
};

const schedulePage = require('./index.js');
const { findSemesterIndexById, resolveScheduleViewState } = schedulePage.__test__;

const duplicatedSemesterData = {
  cacheVersion: 3,
  term: '2025-2026学年第二学期',
  selectedSemesterId: '242',
  termStartDate: '2026-03-09',
  courses: [{ id: 'course-242', weekday: 2, sections: [1, 2, 3, 4] }],
  semesters: [
    { id: '222', label: '2025-2026学年第二学期' },
    { id: '242', label: '2025-2026学年第二学期', selected: true },
    { id: '262', label: '2026-2027学年第一学期' }
  ],
  school: { id: 'wtbu' }
};

const resolved = resolveScheduleViewState(duplicatedSemesterData, '', 1, {
  force: true,
  semesterId: ''
});

assert.strictEqual(resolved.activeSemester.id, '242');
assert.strictEqual(resolved.semesters[0].id, '242');
assert.strictEqual(resolved.semesters[0].label, '2025-2026学年第二学期');
assert.strictEqual(resolved.courses[0].id, 'course-242');
assert.strictEqual(findSemesterIndexById([{ id: '262' }, { id: '242' }], '242'), 1);

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function runPageTests() {
  Object.keys(storage).forEach((key) => {
    delete storage[key];
  });
  toastCalls = [];

  const page = {
    data: {
      loading: false,
      currentWeek: 1,
      currentSchedule: duplicatedSemesterData,
      semesterIndex: 0,
      selectedSemesterId: '242',
      selectedSemesterLabel: '2025-2026学年第二学期',
      semesterOptions: [
        { id: '242', label: '2025-2026学年第二学期' },
        { id: '262', label: '2026-2027学年第一学期' }
      ]
    },
    setData(next) {
      this.data = Object.assign({}, this.data, next);
    }
  };

  Object.keys(pageConfig).forEach((key) => {
    if (typeof pageConfig[key] === 'function') {
      page[key] = pageConfig[key];
    }
  });

  cloudHandler = (data) => {
    if (data && data.action === 'status') {
      return {
        success: true,
        data: { bound: true }
      };
    }

    if (data && data.action === 'getTermWeekConfig') {
      return {
        success: true,
        data: {
          config: {
            sourceText: '管理员配置',
            termStartDate: data.semesterId === '262' ? '2026-09-07' : '2026-03-09'
          }
        }
      };
    }

    if (data && data.semesterId === '262') {
      return {
        success: true,
        data: {
          cacheVersion: 3,
          term: '2026-2027学年第一学期',
          selectedSemesterId: '262',
          termStartDate: '2026-09-07',
          courses: [{ id: 'course-262', weekday: 1, sections: [1] }],
          semesters: [
            { id: '242', label: '2025-2026学年第二学期' },
            { id: '262', label: '2026-2027学年第一学期', selected: true }
          ],
          school: { id: 'wtbu' }
        }
      };
    }

    return {
      success: true,
      data: duplicatedSemesterData
    };
  };

  try {
    page.onSemesterChange({ detail: { value: 1 } });
    assert.strictEqual(toastCalls.length, 1);
    assert.strictEqual(toastCalls[0].title, '本地暂无该学期缓存，请下拉刷新');
    assert.strictEqual(page.data.selectedSemesterId, '242');
    assert.strictEqual(page.data.semesterIndex, 0);
    assert.strictEqual(page.pendingRefreshSemester.id, '262');
    assert.strictEqual(storage.scheduleDataBySemester, undefined);

    const switched = await page.onPullDownRefresh();
    assert.strictEqual(switched, true);
    assert.strictEqual(page.data.currentSchedule.selectedSemesterId, '262');
    assert.strictEqual(page.data.courses[0].id, 'course-262');
    assert.strictEqual(storage.scheduleDataBySemester['262'].selectedSemesterId, '262');
  } finally {
    cloudHandler = null;
  }
}

async function runPickerIndexTest() {
  Object.keys(storage).forEach((key) => {
    delete storage[key];
  });
  toastCalls = [];

  const targetSchedule = {
    cacheVersion: 3,
    term: '2026-2027学年第一学期',
    selectedSemesterId: '262',
    courses: [{ id: 'course-262', weekday: 1, sections: [1] }],
    semesters: [
      { id: '242', label: '2025-2026学年第二学期' },
      { id: '262', label: '2026-2027学年第一学期', selected: true },
      { id: '222', label: '2025-2026学年第一学期' }
    ],
    school: { id: 'wtbu' }
  };

  storage.scheduleDataBySemester = {
    262: targetSchedule
  };

  const page = {
    data: {
      loading: false,
      currentWeek: 1,
      currentSchedule: duplicatedSemesterData,
      semesterIndex: 0,
      selectedSemesterId: '242',
      selectedSemesterLabel: '2025-2026学年第二学期',
      semesterOptions: [
        { id: '242', label: '2025-2026学年第二学期' },
        { id: '262', label: '2026-2027学年第一学期' },
        { id: '222', label: '2025-2026学年第一学期' }
      ]
    },
    setData(next) {
      this.data = Object.assign({}, this.data, next);
    }
  };

  Object.keys(pageConfig).forEach((key) => {
    if (typeof pageConfig[key] === 'function') {
      page[key] = pageConfig[key];
    }
  });

  cloudHandler = (data) => {
    if (data && data.action === 'status') {
      return {
        success: true,
        data: { bound: true }
      };
    }

    if (data && data.action === 'getTermWeekConfig') {
      return {
        success: true,
        data: {
          config: {
            termStartDate: '2026-09-07'
          }
        }
      };
    }

    return {
      success: false,
      code: 'UNEXPECTED',
      message: 'unexpected call'
    };
  };

  try {
    page.onSemesterChange({ detail: { value: 1 } });
    await flushPromises();
    await flushPromises();

    const actualIndex = page.data.semesterOptions.findIndex((semester) => semester.id === page.data.selectedSemesterId);
    assert.strictEqual(page.data.selectedSemesterId, '262');
    assert.strictEqual(page.data.semesterIndex, actualIndex);
    assert.strictEqual(page.data.semesterOptions[page.data.semesterIndex].id, '262');
  } finally {
    cloudHandler = null;
  }
}

runPageTests()
  .then(() => runPickerIndexTest())
  .then(() => {
    console.log('schedule page tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
