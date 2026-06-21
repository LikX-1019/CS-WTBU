const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadCurrentSchedule, loadSchedule } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');
const {
  buildWeekOptions,
  buildDays,
  buildLessons,
  buildPeriods,
  clampWeek,
  formatWeekText,
  getCurrentTeachingWeek
} = require('../../utils/schedule');

const WEEK_SWIPE_MIN_DISTANCE = 60;
const WEEK_SWIPE_MAX_VERTICAL_OFFSET = 80;

function buildTermWeekState(termWeek) {
  const config = termWeek && termWeek.config;

  return {
    termWeekConfig: config || null,
    termWeekProgressText: config
      ? `${config.sourceText || '管理员配置'} · 第1周从 ${config.termStartDate} 开始`
      : '管理员暂未配置该学期起始周'
  };
}

function getSemesterCanonicalKey(semester = {}) {
  const text = String(semester.label || '').replace(/\s+/g, '');
  const match = text.match(/(20\d{2})[-/](20\d{2}).*?(?:第?([12])学期|第?([一二])学期|学期([12]))/);

  if (!match) {
    return `${String(semester.id || '').trim()}::${text}`;
  }

  const termIndex = match[3] || match[5] || (match[4] === '一' ? '1' : (match[4] === '二' ? '2' : ''));
  return `${match[1]}-${match[2]}-${termIndex}`;
}

function normalizeSemestersForView(semesters = [], preferredSemesterId = '') {
  const deduped = new Map();
  const preferredId = String(preferredSemesterId || '');

  (Array.isArray(semesters) ? semesters : []).forEach((semester) => {
    const item = {
      id: String(semester.id || ''),
      label: semester.label || semester.title || '未命名学期',
      selected: Boolean(semester.selected)
    };

    if (!item.id && !item.label) {
      return;
    }

    const key = getSemesterCanonicalKey(item);
    const existing = deduped.get(key);

    if (
      !existing ||
      (item.selected && !existing.selected) ||
      (preferredId && item.id === preferredId && existing.id !== preferredId) ||
      (item.id && !existing.id)
    ) {
      deduped.set(key, item);
    }
  });

  const values = [...deduped.values()];
  const selected = values.filter((semester) => semester.selected || (preferredId && semester.id === preferredId));
  const others = values.filter((semester) => !selected.includes(semester));

  return [...selected, ...others];
}

function resolveScheduleViewState(data, previousTermStartDate = '', currentWeekValue = getCurrentTeachingWeek(), options = {}) {
  const courses = Array.isArray(data.courses) ? data.courses : [];
  const semesters = normalizeSemestersForView(Array.isArray(data.semesters) ? data.semesters : [], data.selectedSemesterId);
  const selectedId = String(data.selectedSemesterId || '');
  const selectedIndex = semesters.findIndex((semester) => semester.id === selectedId);
  const safeIndex = selectedIndex >= 0
    ? selectedIndex
    : Math.max(semesters.findIndex((semester) => Boolean(semester.selected)), 0);
  const activeSemester = semesters[safeIndex] || semesters[0] || {};
  const currentWeek = clampWeek(
    options.force || !options.semesterId || previousTermStartDate !== (data.termStartDate || '')
      ? getCurrentTeachingWeek(new Date(), data.termStartDate)
      : currentWeekValue
  );

  return {
    courses,
    semesters,
    selectedIndex: safeIndex,
    activeSemester,
    currentWeek
  };
}

function createLoadOptions(options = {}, semesterId = '') {
  return {
    force: Boolean(options.force),
    fromDatabase: Boolean(options.fromDatabase),
    semesterId
  };
}

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    weekText: '',
    currentWeek: getCurrentTeachingWeek(),
    weekIndex: getCurrentTeachingWeek() - 1,
    weekOptions: buildWeekOptions(),
    semesterOptions: [],
    semesterIndex: 0,
    selectedSemesterId: '',
    selectedSemesterLabel: '当前学期',
    currentSchedule: null,
    courses: [],
    days: buildDays(getCurrentTeachingWeek()),
    periods: buildPeriods(),
    lessons: [],
    termWeekConfig: null,
    termWeekProgressText: '',
    selectedLesson: null,
    lessonDetailVisible: false,
    loading: false,
    errorText: ''
  }),

  onShow() {
    this.loadSchedule();
  },

  onPullDownRefresh() {
    this.loadSchedule(this.data.selectedSemesterId, {
      fromDatabase: true
    }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadSchedule(semesterId, options = {}) {
    if (this.data.loading) {
      return false;
    }

    this.setData({
      loading: true,
      errorText: ''
    });

    try {
      await ensureBound();

      const requestOptions = createLoadOptions(options, semesterId);
      const data = semesterId
        ? await loadSchedule(requestOptions)
        : await loadCurrentSchedule(requestOptions);

      const termWeekState = buildTermWeekState(data.termWeek || {});
      const previousTermStartDate = this.data.currentSchedule && this.data.currentSchedule.termStartDate || '';
      const viewState = resolveScheduleViewState(data, previousTermStartDate, this.data.currentWeek, {
        force: requestOptions.force,
        semesterId
      });

      this.setData({
        courses: viewState.courses,
        currentSchedule: data,
        currentWeek: viewState.currentWeek,
        weekText: formatWeekText(data.term, viewState.currentWeek, data.termStartDate),
        days: buildDays(viewState.currentWeek, data.termStartDate),
        lessons: buildLessons(viewState.courses, viewState.currentWeek),
        selectedLesson: null,
        lessonDetailVisible: false,
        semesterOptions: viewState.semesters,
        semesterIndex: viewState.selectedIndex,
        selectedSemesterId: data.selectedSemesterId || viewState.activeSemester.id || '',
        selectedSemesterLabel: data.term || viewState.activeSemester.label || '当前学期',
        ...termWeekState
      });

      return true;
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return false;
      }

      if (error.code === 'SEMESTER_NOT_CACHED') {
        wx.showToast({
          title: error.messageText || error.message || '数据库中暂无该学期课表',
          icon: 'none'
        });
        return false;
      }

      this.setData({
        errorText: error.messageText || error.message || '课表加载失败'
      });
      return false;
    } finally {
      this.setData({ loading: false });
    }
  },

  previousWeek() {
    this.switchWeek(this.data.currentWeek - 1);
  },

  nextWeek() {
    this.switchWeek(this.data.currentWeek + 1);
  },

  chooseWeek() {
    wx.showToast({
      title: `当前显示第${this.data.currentWeek}周`,
      icon: 'none'
    });
  },

  onWeekChange(event) {
    this.switchWeek(Number(event.detail.value) + 1);
  },

  onScheduleTouchStart(event) {
    const touch = event.touches && event.touches[0];

    if (!touch) {
      this.scheduleTouchStart = null;
      return;
    }

    this.scheduleTouchStart = {
      x: touch.pageX,
      y: touch.pageY
    };
  },

  onScheduleTouchEnd(event) {
    const touch = event.changedTouches && event.changedTouches[0];
    const start = this.scheduleTouchStart;
    this.scheduleTouchStart = null;

    if (!touch || !start || this.data.lessonDetailVisible) {
      return;
    }

    const deltaX = touch.pageX - start.x;
    const deltaY = touch.pageY - start.y;

    if (
      Math.abs(deltaX) < WEEK_SWIPE_MIN_DISTANCE ||
      Math.abs(deltaY) > WEEK_SWIPE_MAX_VERTICAL_OFFSET ||
      Math.abs(deltaX) <= Math.abs(deltaY)
    ) {
      return;
    }

    if (deltaX < 0) {
      this.nextWeek();
      return;
    }

    this.previousWeek();
  },

  onSemesterChange(event) {
    const index = Number(event.detail.value) || 0;
    const semester = this.data.semesterOptions[index];

    if (!semester) {
      return;
    }

    const previousSemesterIndex = this.data.semesterIndex;
    const previousSemesterId = this.data.selectedSemesterId;
    const previousSemesterLabel = this.data.selectedSemesterLabel;

    this.loadSchedule(semester.id, {
      fromDatabase: true
    }).then((switched) => {
      if (!switched) {
        this.setData({
          semesterIndex: previousSemesterIndex,
          selectedSemesterId: previousSemesterId,
          selectedSemesterLabel: previousSemesterLabel
        });
        return;
      }

      this.setData({
        semesterIndex: index,
        selectedSemesterId: semester.id,
        selectedSemesterLabel: semester.label
      });
    });
  },

  switchWeek(week) {
    const currentWeek = clampWeek(week);
    const termStartDate = this.data.currentSchedule && this.data.currentSchedule.termStartDate || '';

    this.setData({
      currentWeek,
      weekIndex: currentWeek - 1,
      weekText: formatWeekText('', currentWeek, termStartDate),
      days: buildDays(currentWeek, termStartDate),
      lessons: buildLessons(this.data.courses, currentWeek),
      selectedLesson: null,
      lessonDetailVisible: false
    });
  },

  openLessonDetail(event) {
    const index = Number(event.currentTarget.dataset.index);
    const lesson = this.data.lessons[index];

    if (!lesson) {
      return;
    }

    this.setData({
      selectedLesson: lesson,
      lessonDetailVisible: true
    });
  },

  closeLessonDetail() {
    this.setData({
      lessonDetailVisible: false
    });
  },

  noop() {},

  goHome() {
    goTab('home');
  },

  goSchedule() {
    goTab('schedule');
  },

  goGrades() {
    goTab('grades');
  },

  goProfile() {
    goTab('profile');
  }
});

module.exports = {
  __test__: {
    getSemesterCanonicalKey,
    normalizeSemestersForView,
    resolveScheduleViewState
  }
};
