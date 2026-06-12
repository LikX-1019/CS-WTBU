const WEEKDAY_TEXT = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TERM_START = { year: 2026, month: 3, day: 2 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_WEEK_COUNT = 20;
const SECTION_TIMES = {
  1: { start: '08:20', end: '09:05' },
  2: { start: '09:15', end: '10:00' },
  3: { start: '10:20', end: '11:05' },
  4: { start: '11:15', end: '12:00' },
  5: { start: '12:10', end: '12:55' },
  6: { start: '13:05', end: '13:50' },
  7: { start: '14:10', end: '14:55' },
  8: { start: '15:05', end: '15:50' },
  9: { start: '16:10', end: '16:55' },
  10: { start: '17:05', end: '17:50' },
  11: { start: '18:30', end: '19:15' },
  12: { start: '19:20', end: '20:10' },
  13: { start: '20:20', end: '21:05' }
};
const TONES = ['blue', 'green', 'purple', 'yellow', 'red', 'cyan'];
const ICONS = ['book', 'flask', 'code'];
const EXAM_STATUS_PRIORITY = {
  upcoming: 0,
  completed: 1,
  unscheduled: 2
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function getTodayText() {
  const date = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日　${weekdays[date.getDay()]}`;
}

function getCurrentWeekday() {
  const day = new Date().getDay();

  return day === 0 ? 7 : day;
}

function createDate(year, month, day) {
  return new Date(year, month - 1, day);
}

function getTermStartDate() {
  return createDate(TERM_START.year, TERM_START.month, TERM_START.day);
}

function getDayStart(date) {
  return createDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);

  return value;
}

function clampWeek(week) {
  return Math.min(Math.max(Number(week) || 1, 1), MAX_WEEK_COUNT);
}

function getCurrentTeachingWeek(date = new Date()) {
  const today = getDayStart(date);
  const diffDays = Math.floor((today.getTime() - getTermStartDate().getTime()) / MS_PER_DAY);

  return clampWeek(Math.floor(diffDays / 7) + 1);
}

function getWeekStartDate(week = getCurrentTeachingWeek()) {
  return addDays(getTermStartDate(), (clampWeek(week) - 1) * 7);
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function buildWeekOptions() {
  return Array.from({ length: MAX_WEEK_COUNT }, (_, index) => `第${index + 1}周`);
}

function formatSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return '';
  }

  if (sections.length === 1) {
    return `${sections[0]}节`;
  }

  return `${sections[0]}-${sections[sections.length - 1]}节`;
}

function formatCourseTime(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return '';
  }

  const first = SECTION_TIMES[sections[0]];
  const last = SECTION_TIMES[sections[sections.length - 1]];

  if (!first || !last) {
    return '';
  }

  return `${first.start}-${last.end}`;
}

function formatWeeks(weeks) {
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return '全周';
  }

  const ranges = [];
  let start = weeks[0];
  let end = weeks[0];

  for (let index = 1; index < weeks.length; index += 1) {
    const week = weeks[index];

    if (week === end + 1) {
      end = week;
      continue;
    }

    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = week;
    end = week;
  }

  ranges.push(start === end ? `${start}` : `${start}-${end}`);

  return `${ranges.join('、')}周`;
}

function getCourseTone(course, index) {
  const source = `${course.name || ''}${course.location || ''}`;
  let sum = index;

  for (let i = 0; i < source.length; i += 1) {
    sum += source.charCodeAt(i);
  }

  return TONES[sum % TONES.length];
}

function splitCourseName(name) {
  const value = String(name || '课程');

  if (value.length <= 2) {
    return [value];
  }

  if (value.length <= 4) {
    return [value.slice(0, 2), value.slice(2)];
  }

  return [value.slice(0, 2), value.slice(2, 4), value.slice(4, 8)];
}

function normalizeCourses(courses) {
  return (Array.isArray(courses) ? courses : []).map((course, index) => {
    const sections = Array.isArray(course.sections) ? course.sections : [];
    const tone = getCourseTone(course, index);

    return Object.assign({}, course, {
      id: course.id || `${course.name || 'course'}-${course.weekday || 0}-${index}`,
      weekday: Number(course.weekday) || 0,
      sections,
      section: formatSections(sections),
      time: formatCourseTime(sections),
      sortTime: formatCourseTime(sections).slice(0, 5),
      type: 'course',
      name: course.name || '未命名课程',
      location: course.location || '地点待定',
      teacher: course.teacher || '教师待定',
      icon: ICONS[index % ICONS.length],
      tone
    });
  });
}

function isCourseActiveInWeek(course, week) {
  if (!Array.isArray(course.weeks) || course.weeks.length === 0) {
    return true;
  }

  return course.weeks.includes(week);
}

function getTodayCourses(courses) {
  const weekday = getCurrentWeekday();
  const week = getCurrentTeachingWeek();

  return normalizeCourses(courses)
    .filter((course) => course.weekday === weekday && isCourseActiveInWeek(course, week))
    .sort((a, b) => (a.sections[0] || 0) - (b.sections[0] || 0));
}

function parseExamDate(value, baseDate = new Date()) {
  const text = String(value || '').trim();
  const fullDate = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);

  if (fullDate) {
    return createDate(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
  }

  const shortDate = text.match(/(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*(?:日)?/);

  if (shortDate) {
    return createDate(baseDate.getFullYear(), Number(shortDate[1]), Number(shortDate[2]));
  }

  return null;
}

function isSameDate(left, right) {
  return left &&
    right &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

function getExamSortTime(exam) {
  const source = [exam.startTime, exam.time, exam.dateTime, exam.date].join(' ');
  const match = String(source).match(/(\d{1,2}):(\d{2})/);

  if (!match) {
    return '99:99';
  }

  return `${pad(match[1])}:${match[2]}`;
}

function parseExamTimeRange(value) {
  const matches = [...String(value || '').matchAll(/(\d{1,2}):(\d{2})/g)]
    .map((match) => ({
      hour: Number(match[1]),
      minute: Number(match[2])
    }))
    .filter((time) => (
      Number.isFinite(time.hour) &&
      Number.isFinite(time.minute) &&
      time.hour >= 0 &&
      time.hour <= 23 &&
      time.minute >= 0 &&
      time.minute <= 59
    ));

  return {
    start: matches[0] || null,
    end: matches[1] || null,
    hasEnd: matches.length > 1
  };
}

function buildExamDateTime(date, time) {
  if (!date || !time) {
    return null;
  }

  const value = new Date(date);
  value.setHours(time.hour, time.minute, 0, 0);

  return value;
}

function getExamStatus(exam, examDate, now = new Date()) {
  const source = [exam.status, exam.date, exam.time, exam.dateTime, exam.location, exam.seat].join(' ');
  const timeRange = parseExamTimeRange([exam.time, exam.dateTime].join(' '));

  if (!examDate || !timeRange.start || /未安排|待安排|待定/.test(source)) {
    return {
      key: 'unscheduled',
      text: '未安排'
    };
  }

  const today = getDayStart(now);
  const examDay = getDayStart(examDate);
  const endDateTime = timeRange.hasEnd ? buildExamDateTime(examDate, timeRange.end) : null;

  if (endDateTime && now.getTime() > endDateTime.getTime()) {
    return {
      key: 'completed',
      text: '已考完'
    };
  }

  if (!endDateTime && examDay.getTime() < today.getTime()) {
    return {
      key: 'completed',
      text: '已考完'
    };
  }

  return {
    key: 'upcoming',
    text: '未考'
  };
}

function getTodayExams(exams, now = new Date()) {
  const today = getDayStart(now);

  return normalizeExamItems(exams, now)
    .filter((exam) => exam.examStatusKey !== 'unscheduled' && isSameDate(exam.examDate, today))
    .sort((a, b) => a.sortTime.localeCompare(b.sortTime));
}

function formatExamDateText(date) {
  if (!date) {
    return '日期待定';
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getExamStatusPriority(statusKey) {
  if (Object.prototype.hasOwnProperty.call(EXAM_STATUS_PRIORITY, statusKey)) {
    return EXAM_STATUS_PRIORITY[statusKey];
  }

  return 9;
}

function normalizeExamItems(exams, now = new Date()) {
  return (Array.isArray(exams) ? exams : [])
    .map((exam, index) => {
      const examDate = parseExamDate(exam.date || exam.dateTime || exam.time);
      const sortTime = getExamSortTime(exam);
      const displayTime = exam.time || [exam.date, exam.startTime].filter(Boolean).join(' ');
      const seat = exam.seat ? `座位 ${exam.seat}` : '';
      const examStatus = getExamStatus(exam, examDate, now);
      const batchName = exam.batchName || '';
      const teacher = examStatus.key === 'completed' ?
        examStatus.text :
        seat || examStatus.text;

      return Object.assign({}, exam, {
        id: exam.id || `exam-${index}`,
        type: 'exam',
        section: '考试',
        batchName,
        dateText: formatExamDateText(examDate),
        time: displayTime || '时间待定',
        sortTime,
        name: exam.name || exam.courseName || '未命名考试',
        location: exam.location || '地点待定',
        teacher,
        examStatusKey: examStatus.key,
        examStatusText: examStatus.text,
        statusText: examStatus.text,
        seatText: seat || '座位待定',
        icon: 'exam',
        tone: 'red',
        examDate
      });
    })
    .sort((a, b) => {
      const statusCompare = getExamStatusPriority(a.examStatusKey) - getExamStatusPriority(b.examStatusKey);

      if (statusCompare !== 0) {
        return statusCompare;
      }

      const leftDate = a.examDate ? a.examDate.getTime() : Number.MAX_SAFE_INTEGER;
      const rightDate = b.examDate ? b.examDate.getTime() : Number.MAX_SAFE_INTEGER;

      if (leftDate !== rightDate) {
        if (a.examStatusKey === 'completed' && b.examStatusKey === 'completed') {
          return rightDate - leftDate;
        }

        return leftDate - rightDate;
      }

      const timeCompare = a.sortTime.localeCompare(b.sortTime);

      if (timeCompare !== 0) {
        return timeCompare;
      }

      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function getTodayScheduleItems(courses, exams) {
  return [
    ...getTodayCourses(courses),
    ...getTodayExams(exams)
  ].sort((a, b) => {
    const timeCompare = String(a.sortTime || '99:99').localeCompare(String(b.sortTime || '99:99'));

    if (timeCompare !== 0) {
      return timeCompare;
    }

    return a.type === 'exam' ? 1 : -1;
  });
}

function buildDays(week = getCurrentTeachingWeek()) {
  const start = getWeekStartDate(clampWeek(week));

  return WEEKDAY_TEXT.slice(1).map((week, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      week,
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      style: `left: ${12 + index * 12.57}%; top: 0; width: 12.57%; height: 100rpx;`
    };
  });
}

function buildPeriods() {
  return Object.keys(SECTION_TIMES).map((key) => ({
    index: Number(key),
    start: SECTION_TIMES[key].start,
    end: SECTION_TIMES[key].end,
    style: `left: 0; top: ${100 + (Number(key) - 1) * 110}rpx; width: 12%; height: 110rpx;`
  }));
}

function buildLessons(courses, week = getCurrentTeachingWeek()) {
  const currentWeek = clampWeek(week);

  return normalizeCourses(courses)
    .filter((course) => (
      course.weekday >= 1 &&
      course.weekday <= 7 &&
      course.sections.length > 0 &&
      isCourseActiveInWeek(course, currentWeek)
    ))
    .map((course, index) => {
      const firstSection = course.sections[0];
      const span = Math.max(course.sections.length, 1);

      return {
        id: course.id || `lesson-${index}`,
        name: course.name,
        nameLines: splitCourseName(course.name),
        room: course.location,
        teacher: course.teacher,
        location: course.location,
        section: course.section,
        time: course.time,
        weekdayText: WEEKDAY_TEXT[course.weekday] || '',
        weeksText: formatWeeks(course.weeks),
        detailRows: [
          { label: '任课教师', value: course.teacher },
          { label: '上课地点', value: course.location },
          { label: '上课周次', value: formatWeeks(course.weeks) },
          { label: '节次', value: course.section },
          { label: '上课时间', value: course.time },
          { label: '星期', value: WEEKDAY_TEXT[course.weekday] || '' }
        ].filter((row) => row.value),
        tone: course.tone,
        style: [
          `left: ${12 + (course.weekday - 1) * 12.57}%`,
          `top: ${100 + (firstSection - 1) * 110}rpx`,
          'width: 12.57%',
          `height: ${span * 110}rpx`
        ].join('; ')
      };
    });
}

function formatWeekText(term, week = getCurrentTeachingWeek()) {
  const currentWeek = clampWeek(week);
  const start = getWeekStartDate(currentWeek);
  const end = addDays(start, 6);

  return `第${currentWeek}周 (${formatShortDate(start)}-${formatShortDate(end)})`;
}

function getEmptyProfile() {
  return {
    name: '未绑定',
    number: '',
    major: '暂无专业信息',
    level: '',
    role: '',
    grade: '',
    className: '',
    avatarUrl: ''
  };
}

function formatProfile(profile) {
  const data = profile || {};
  const studentId = data.studentId || data.maskedStudentId || '';
  const major = data.major || '暂无专业信息';
  const gradeLevel = [data.grade, data.level].filter(Boolean).join('　');

  return {
    student: {
      name: data.name || '未绑定',
      number: studentId,
      major,
      className: data.className || '',
      level: gradeLevel || data.role || '',
      avatarUrl: data.avatarUrl || ''
    },
    baseInfo: [
      { label: '性别', value: data.gender || '暂无' },
      { label: '出生年月', value: data.birthDate || '暂无' },
      { label: '政治面貌', value: data.politicalStatus || '暂无' },
      { label: '手机号', value: data.phone || '暂无' },
      { label: '邮箱', value: data.email || '暂无' },
      { label: '籍贯', value: data.nativePlace || '暂无' },
      { label: '入学时间', value: data.enrollmentDate || '暂无' }
    ]
  };
}

function formatFetchTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  MAX_WEEK_COUNT,
  buildDays,
  buildLessons,
  buildPeriods,
  buildWeekOptions,
  clampWeek,
  formatFetchTime,
  formatProfile,
  formatWeekText,
  getCurrentTeachingWeek,
  getEmptyProfile,
  getTodayCourses,
  getTodayExams,
  getTodayScheduleItems,
  getTodayText,
  normalizeExamItems,
  normalizeCourses
};
