const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadSchedule, submitTermWeekReport } = require('../../utils/dataStore');
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

function formatDateInput(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay();
  const offset = day === 0 ? -6 : 1 - day;

  value.setDate(value.getDate() + offset);

  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('-');
}

function buildTermWeekState(termWeek) {
  const config = termWeek && termWeek.config;
  const report = termWeek && termWeek.report;
  const progress = termWeek && termWeek.progress || {};
  const progressText = config ?
    `${config.sourceText || '官方配置'} · 第1周从 ${config.termStartDate} 开始` :
    `已有 ${progress.reportCount || 0}/${progress.targetCount || 10} 位同学上报`;

  return {
    termWeekConfig: config || null,
    termWeekReport: report || null,
    termWeekProgress: progress,
    canSubmitTermWeekReport: Boolean(termWeek && termWeek.canSubmitReport),
    termWeekProgressText: progressText,
    reportWeekNumber: report && report.weekNumber ? report.weekNumber : 1,
    reportWeekIndex: report && report.weekNumber ? report.weekNumber - 1 : 0,
    reportWeekMondayDate: report && report.weekMondayDate ? report.weekMondayDate : formatDateInput()
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
    termWeekReport: null,
    termWeekProgress: null,
    canSubmitTermWeekReport: false,
    termWeekProgressText: '',
    reportWeekNumber: 1,
    reportWeekIndex: 0,
    reportWeekMondayDate: formatDateInput(),
    submittingTermWeek: false,
    selectedLesson: null,
    lessonDetailVisible: false,
    loading: false,
    errorText: ''
  }),

  onShow() {
    this.loadSchedule();
  },

  onPullDownRefresh() {
    this.loadSchedule(this.data.selectedSemesterId, { force: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadSchedule(semesterId, options = {}) {
    if (this.data.loading) {
      return;
    }

    this.setData({
      loading: true,
      errorText: ''
    });

    try {
      await ensureBound();
      const selectedSemesterId = semesterId || this.data.selectedSemesterId;
      const data = await loadSchedule({
        force: Boolean(options.force || semesterId),
        semesterId: selectedSemesterId
      });

      const courses = Array.isArray(data.courses) ? data.courses : [];
      const semesters = this.normalizeSemesters(data);
      const selectedIndex = this.getSelectedSemesterIndex(semesters, data.selectedSemesterId);
      const activeSemester = semesters[selectedIndex] || semesters[0] || {};
      const termWeekState = buildTermWeekState(data.termWeek || {});
      const currentWeek = clampWeek(this.data.currentWeek);

      this.setData({
        courses,
        currentSchedule: data,
        currentWeek,
        weekText: formatWeekText(data.term, currentWeek, data.termStartDate),
        days: buildDays(currentWeek, data.termStartDate),
        lessons: buildLessons(courses, currentWeek),
        selectedLesson: null,
        lessonDetailVisible: false,
        semesterOptions: semesters,
        semesterIndex: selectedIndex,
        selectedSemesterId: activeSemester.id || '',
        selectedSemesterLabel: activeSemester.label || data.term || '当前学期',
        ...termWeekState
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      this.setData({
        errorText: error.messageText || error.message || '课表加载失败'
      });
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

    this.setData({
      semesterIndex: index,
      selectedSemesterId: semester.id,
      selectedSemesterLabel: semester.label
    });
    this.loadSchedule(semester.id, { force: true });
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

  onReportDateChange(event) {
    this.setData({
      reportWeekMondayDate: event.detail.value
    });
  },

  onReportWeekChange(event) {
    const reportWeekNumber = Number(event.detail.value) + 1;

    this.setData({
      reportWeekNumber,
      reportWeekIndex: reportWeekNumber - 1
    });
  },

  async submitTermWeekReport() {
    if (this.data.submittingTermWeek || !this.data.currentSchedule) {
      return;
    }

    this.setData({ submittingTermWeek: true });

    try {
      const termWeek = await submitTermWeekReport(this.data.currentSchedule, {
        weekNumber: this.data.reportWeekNumber,
        weekMondayDate: this.data.reportWeekMondayDate
      });
      const currentSchedule = Object.assign({}, this.data.currentSchedule, {
        termWeek,
        termStartDate: termWeek && termWeek.termStartDate || this.data.currentSchedule.termStartDate || ''
      });
      const currentWeek = clampWeek(this.data.currentWeek);

      this.setData({
        currentSchedule,
        weekText: formatWeekText(currentSchedule.term, currentWeek, currentSchedule.termStartDate),
        days: buildDays(currentWeek, currentSchedule.termStartDate),
        lessons: buildLessons(this.data.courses, currentWeek),
        ...buildTermWeekState(termWeek)
      });
      wx.showToast({
        title: termWeek && termWeek.config ? '已生成官方配置' : '已上报',
        icon: 'success'
      });
    } catch (error) {
      wx.showToast({
        title: error.messageText || error.message || '上报失败',
        icon: 'none'
      });
    } finally {
      this.setData({ submittingTermWeek: false });
    }
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

  normalizeSemesters(data) {
    const semesters = (Array.isArray(data.semesters) ? data.semesters : [])
      .map((semester) => ({
        id: String(semester.id || ''),
        label: semester.label || semester.title || '未命名学期'
      }))
      .filter((semester) => semester.id || semester.label);

    if (semesters.length > 0) {
      return semesters;
    }

    return [{
      id: data.selectedSemesterId || '',
      label: data.term || '当前学期'
    }];
  },

  getSelectedSemesterIndex(semesters, selectedSemesterId) {
    const selectedId = String(selectedSemesterId || '');
    const index = semesters.findIndex((semester) => semester.id === selectedId);

    return index >= 0 ? index : 0;
  },

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
