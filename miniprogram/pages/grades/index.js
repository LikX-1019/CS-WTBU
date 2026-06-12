const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { getScheduleCache, loadGrades, loadSchedule } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');
const { normalizeExamItems } = require('../../utils/schedule');

const EMPTY_SUMMARY = [
  { label: '总学分', value: '--' },
  { label: '平均分', value: '--' },
  { label: '绩点', value: '--' }
];
const EMPTY_EXAM_SUMMARY = {
  total: 0,
  title: '暂无考试安排',
  subtitle: ''
};

function buildExamItems(exams, previousExams = []) {
  const expandedById = Object.create(null);

  previousExams.forEach((exam) => {
    if (exam && exam.id) {
      expandedById[exam.id] = Boolean(exam.expanded);
    }
  });

  return normalizeExamItems(exams).map((exam) => {
    const hasPreviousState = Object.prototype.hasOwnProperty.call(expandedById, exam.id);

    return Object.assign({}, exam, {
      expanded: hasPreviousState ? expandedById[exam.id] : false
    });
  });
}

function buildExamSummary(exams = []) {
  const summary = {
    total: exams.length,
    upcoming: 0,
    completed: 0,
    unscheduled: 0
  };

  exams.forEach((exam) => {
    if (exam.examStatusKey === 'upcoming') {
      summary.upcoming += 1;
      return;
    }

    if (exam.examStatusKey === 'completed') {
      summary.completed += 1;
      return;
    }

    summary.unscheduled += 1;
  });

  const parts = [];

  if (summary.upcoming > 0) {
    parts.push(`${summary.upcoming}场未考`);
  }

  if (summary.completed > 0) {
    parts.push(`${summary.completed}场已考完`);
  }

  if (summary.unscheduled > 0) {
    parts.push(`${summary.unscheduled}场未安排`);
  }

  const highlight = exams.find((exam) => exam.examStatusKey === 'upcoming') ||
    exams.find((exam) => exam.examStatusKey === 'completed') ||
    exams[0];

  if (!highlight) {
    return EMPTY_EXAM_SUMMARY;
  }

  const title = parts.length > 0 ? parts.join(' · ') : `${summary.total}场考试`;
  const subtitle = highlight.examStatusKey === 'upcoming' ?
    `下一场 ${highlight.name} · ${highlight.dateText} ${highlight.time}` :
    `${highlight.name} · ${highlight.examStatusText}`;

  return Object.assign({}, summary, {
    title,
    subtitle
  });
}

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    summary: EMPTY_SUMMARY,
    semesters: [],
    exams: [],
    examSummary: EMPTY_EXAM_SUMMARY,
    examListExpanded: false,
    loading: false,
    errorText: '',
    emptyText: '暂无成绩数据',
    examEmptyText: '暂无已安排考试'
  }),

  onShow() {
    this.loadGrades();
  },

  onPullDownRefresh() {
    this.loadGrades({ force: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadGrades(options = {}) {
    if (this.data.loading) {
      return;
    }

    this.setData({
      loading: true,
      errorText: ''
    });

    try {
      await ensureBound();
      const data = await loadGrades(options);
      const schedule = await this.loadExamSchedule(options);
      const exams = buildExamItems(schedule && schedule.exams, this.data.exams);

      this.setData({
        summary: Array.isArray(data.summary) ? data.summary : EMPTY_SUMMARY,
        semesters: Array.isArray(data.semesters) ? data.semesters : [],
        exams,
        examSummary: buildExamSummary(exams)
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      this.setData({
        errorText: error.messageText || error.message || '成绩加载失败'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadExamSchedule(options = {}) {
    const cached = getScheduleCache() || {};

    try {
      if (options.force || !cached.exams) {
        return await loadSchedule({
          force: Boolean(options.force)
        });
      }
    } catch (error) {
      return cached;
    }

    return cached;
  },

  toggleSemester(event) {
    const index = Number(event.currentTarget.dataset.index);
    const semesters = this.data.semesters.map((semester, itemIndex) => {
      if (itemIndex !== index) {
        return semester;
      }

      return Object.assign({}, semester, {
        expanded: !semester.expanded
      });
    });

    this.setData({ semesters });
  },

  toggleExamList() {
    const examListExpanded = !this.data.examListExpanded;
    const nextData = { examListExpanded };

    if (examListExpanded) {
      nextData.exams = this.data.exams.map((exam) => Object.assign({}, exam, {
        expanded: false
      }));
    }

    this.setData(nextData);
  },

  toggleExam(event) {
    const index = Number(event.currentTarget.dataset.index);

    if (!Number.isFinite(index) || index < 0 || index >= this.data.exams.length) {
      return;
    }

    const exams = this.data.exams.map((exam, itemIndex) => {
      if (itemIndex !== index) {
        return exam;
      }

      return Object.assign({}, exam, {
        expanded: !exam.expanded
      });
    });

    this.setData({ exams });
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
