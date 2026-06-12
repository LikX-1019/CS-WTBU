const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadSchedule } = require('../../utils/dataStore');
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
    courses: [],
    days: buildDays(getCurrentTeachingWeek()),
    periods: buildPeriods(),
    lessons: [],
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
      const currentWeek = clampWeek(this.data.currentWeek);

      this.setData({
        courses,
        currentWeek,
        weekText: formatWeekText(data.term, currentWeek),
        days: buildDays(currentWeek),
        lessons: buildLessons(courses, currentWeek),
        selectedLesson: null,
        lessonDetailVisible: false,
        semesterOptions: semesters,
        semesterIndex: selectedIndex,
        selectedSemesterId: activeSemester.id || '',
        selectedSemesterLabel: activeSemester.label || data.term || '当前学期'
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

    this.setData({
      currentWeek,
      weekIndex: currentWeek - 1,
      weekText: formatWeekText('', currentWeek),
      days: buildDays(currentWeek),
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
