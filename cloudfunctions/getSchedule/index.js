const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { CookieJar } = require('tough-cookie');
const { HttpCookieAgent, HttpsCookieAgent } = require('http-cookie-agent/http');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const EDU_CONFIG = {
  baseUrl: 'https://jxgl.wtbu.edu.cn',
  loginPath: '/eams/login.action',
  homePath: '/eams/home.action',
  scheduleIndexPath: '/eams/courseTableForStd.action',
  scheduleTablePath: '/eams/courseTableForStd!courseTable.action'
};
const BINDING_COLLECTION = 'eduAccountBindings';
const PASSWORD_SECRET_ENV = 'EDU_PASSWORD_SECRET';

class PublicError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function getErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error.message && typeof error.message === 'string') {
    return error.message;
  }

  if (error.errMsg && typeof error.errMsg === 'string') {
    return error.errMsg;
  }

  try {
    return JSON.stringify(error);
  } catch (stringifyError) {
    return fallback;
  }
}

function createEduClient() {
  const jar = new CookieJar();

  return axios.create({
    baseURL: EDU_CONFIG.baseUrl,
    httpAgent: new HttpCookieAgent({ cookies: { jar } }),
    // The school server currently serves an incomplete certificate chain.
    // Scope this TLS exception to the fixed educational system client only.
    httpsAgent: new HttpsCookieAgent({ cookies: { jar }, rejectUnauthorized: false }),
    withCredentials: true,
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 MiniProgram Schedule Fetcher',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });
}

function getTextFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseProfile(homeHtml, fallbackStudentId) {
  const text = getTextFromHtml(homeHtml);
  const accountMatch = text.match(/([\u4e00-\u9fa5A-Za-z·]{2,30})\(([^)]+)\)\s+([^\s]+)/);
  const name = accountMatch ? accountMatch[1] : '';
  const studentId = accountMatch ? accountMatch[2] : fallbackStudentId;
  const role = accountMatch ? accountMatch[3] : '学生';

  return {
    name,
    studentId,
    role,
    maskedStudentId: maskStudentId(studentId),
    major: '',
    grade: '',
    level: '',
    className: '',
    gender: '',
    birthDate: '',
    politicalStatus: '',
    phone: '',
    email: '',
    nativePlace: '',
    enrollmentDate: '',
    studentStatus: '',
    dormitory: '',
    counselor: '',
    updatedAt: new Date().toISOString()
  };
}

function firstValue(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function normalizeLabel(value) {
  return cleanText(value)
    .replace(/[：:]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function getPairValue(pairs, labels) {
  const entries = Object.entries(pairs || {});

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel);

    if (exact && exact[1]) {
      return exact[1];
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key);
      return normalizedKey.includes(normalizedLabel) || normalizedLabel.includes(normalizedKey);
    });

    if (fuzzy && fuzzy[1]) {
      return fuzzy[1];
    }
  }

  return '';
}

function parseKeyValuePairs(html) {
  const $ = cheerio.load(String(html || ''));
  const pairs = {};

  function addPair(label, value) {
    const key = normalizeLabel(label);
    const text = cleanText(value);

    if (!key || !text || key.length > 24) {
      return;
    }

    pairs[key] = text;
  }

  $('tr').each((index, row) => {
    const cells = $(row)
      .find('th,td')
      .map((cellIndex, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);

    if (cells.length < 2) {
      return;
    }

    for (let index = 0; index < cells.length - 1; index += 2) {
      addPair(cells[index], cells[index + 1]);
    }
  });

  const text = getTextFromHtml(html);
  const labels = [
    '姓名', '学号', '性别', '出生年月', '出生日期', '政治面貌', '手机号', '联系电话',
    '邮箱', '电子邮箱', '籍贯', '生源地', '入学时间', '入学日期', '学籍状态',
    '学生状态', '宿舍信息', '宿舍', '辅导员', '班级', '行政班', '专业', '专业名称',
    '年级', '培养层次', '层次'
  ];

  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[：:]\\s*([^：:]{1,80}?)(?=\\s+(?:${labels.join('|')})\\s*[：:]|$)`);
    const match = text.match(pattern);

    if (match) {
      addPair(label, match[1]);
    }
  }

  return pairs;
}

function mergeProfile(baseProfile, detailHtml, fallbackStudentId) {
  const base = baseProfile || parseProfile('', fallbackStudentId);
  const pairs = parseKeyValuePairs(detailHtml);
  const studentId = firstValue(
    getPairValue(pairs, ['学号', '学籍号']),
    base.studentId,
    fallbackStudentId
  );

  return {
    ...base,
    name: firstValue(getPairValue(pairs, ['姓名']), base.name),
    studentId,
    role: firstValue(base.role, '学生'),
    maskedStudentId: maskStudentId(studentId),
    major: firstValue(getPairValue(pairs, ['专业名称', '专业']), base.major),
    grade: firstValue(getPairValue(pairs, ['年级']), base.grade),
    level: firstValue(getPairValue(pairs, ['培养层次', '层次']), base.level),
    className: firstValue(getPairValue(pairs, ['行政班', '班级']), base.className),
    gender: firstValue(getPairValue(pairs, ['性别']), base.gender),
    birthDate: firstValue(getPairValue(pairs, ['出生日期', '出生年月']), base.birthDate),
    politicalStatus: firstValue(getPairValue(pairs, ['政治面貌']), base.politicalStatus),
    phone: firstValue(getPairValue(pairs, ['手机号', '联系电话', '电话']), base.phone),
    email: firstValue(getPairValue(pairs, ['电子邮箱', '邮箱']), base.email),
    nativePlace: firstValue(getPairValue(pairs, ['籍贯', '生源地']), base.nativePlace),
    enrollmentDate: firstValue(getPairValue(pairs, ['入学日期', '入学时间']), base.enrollmentDate),
    studentStatus: firstValue(getPairValue(pairs, ['学籍状态', '学生状态']), base.studentStatus),
    dormitory: firstValue(getPairValue(pairs, ['宿舍信息', '宿舍']), base.dormitory),
    counselor: firstValue(getPairValue(pairs, ['辅导员']), base.counselor),
    updatedAt: new Date().toISOString()
  };
}

function extractHrefFromOnclick(onclick) {
  const text = String(onclick || '');
  const match = text.match(/(?:location\.href|open|href|url)\s*\(?\s*['"]([^'"]+)['"]/i) ||
    text.match(/['"](\/eams\/[^'"]+)['"]/i);

  return match ? match[1] : '';
}

function normalizeEduHref(href) {
  const value = String(href || '').trim();

  if (!value || /^javascript:/i.test(value) || value === '#') {
    return '';
  }

  try {
    const url = new URL(value, EDU_CONFIG.baseUrl);

    if (url.origin !== EDU_CONFIG.baseUrl) {
      return '';
    }

    return `${url.pathname}${url.search}`;
  } catch (error) {
    return '';
  }
}

function findEduLinksByKeywords(html, keywords) {
  const source = String(html || '');
  const $ = cheerio.load(source);
  const candidates = [];

  $('a,area').each((index, element) => {
    const $element = $(element);
    const text = cleanText([$element.text(), $element.attr('title'), $element.attr('href')].join(' '));
    const onclick = $element.attr('onclick') || '';
    const content = `${text} ${onclick}`;
    const matched = keywords.some((keyword) => content.includes(keyword));
    const href = normalizeEduHref($element.attr('href')) || normalizeEduHref(extractHrefFromOnclick(onclick));

    if (matched && href) {
      candidates.push(href);
    }
  });

  for (const keyword of keywords) {
    const pattern = new RegExp(`.{0,160}${keyword}.{0,160}`, 'g');
    const snippets = source.match(pattern) || [];

    for (const snippet of snippets) {
      const matches = snippet.match(/\/eams\/[^'"<>\s)]+/g) || [];
      candidates.push(...matches.map(normalizeEduHref).filter(Boolean));
    }
  }

  return [...new Set(candidates)];
}

async function fetchEduPageByKeywords(client, homeHtml, keywords, fallbackPaths) {
  const paths = [
    ...findEduLinksByKeywords(homeHtml, keywords),
    ...fallbackPaths
  ].map(normalizeEduHref).filter(Boolean);
  const uniquePaths = [...new Set(paths)];

  for (const path of uniquePaths) {
    try {
      const response = await client.get(path, {
        validateStatus(status) {
          return status >= 200 && status < 400;
        }
      });
      const html = String(response.data || '');

      if (!html || html.includes('loginForm') || html.includes('请输入用户名')) {
        continue;
      }

      return html;
    } catch (error) {
      console.warn(`fetch edu page failed: ${path}`, getErrorMessage(error, ''));
    }
  }

  return '';
}

async function loginToEduSystem(client, studentId, password) {
  const loginPage = await client.get(EDU_CONFIG.homePath);
  const loginHtml = String(loginPage.data || '');
  const saltMatch = loginHtml.match(/CryptoJS\.SHA1\('([^']*)'\s*\+\s*form\['password'\]\.value\)/);

  if (!saltMatch) {
    throw new Error('无法读取教务系统登录参数');
  }

  const hashedPassword = crypto
    .createHash('sha1')
    .update(`${saltMatch[1]}${password}`, 'utf8')
    .digest('hex');

  const loginPayload = new URLSearchParams({
    username: studentId,
    password: hashedPassword,
    encodedPassword: '',
    session_locale: 'zh_CN'
  });

  const response = await client.post(EDU_CONFIG.loginPath, loginPayload.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    maxRedirects: 0,
    validateStatus(status) {
      return status >= 200 && status < 400;
    }
  });

  const body = String(response.data || '');

  if (body.includes('密码错误') || body.includes('登录失败') || body.includes('用户名') && body.includes('密码')) {
    throw new Error('学号或密码错误');
  }

  const homePage = await client.get(EDU_CONFIG.homePath);
  const homeHtml = String(homePage.data || '');

  if (homeHtml.includes('loginForm') || homeHtml.includes('请输入用户名')) {
    throw new Error('学号或密码错误');
  }

  return homeHtml;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getCurrentSemesterId(indexHtml) {
  const html = String(indexHtml || '');
  const $ = cheerio.load(html);
  const selectedOption = $('select[name="semester.id"] option[selected]').first().attr('value');
  const inputValue = $('input[name="semester.id"]').first().attr('value');
  const inputMatch = html.match(/name=["']semester\.id["'][^>]*value=["']([^"']*)["']/i) ||
    html.match(/value=["']([^"']*)["'][^>]*name=["']semester\.id["']/i);

  return selectedOption || inputValue || (inputMatch ? inputMatch[1] : '');
}

function parseSemesters(indexHtml) {
  const $ = cheerio.load(String(indexHtml || ''));
  const semesters = [];

  $('select[name="semester.id"] option').each((index, option) => {
    const $option = $(option);
    const id = String($option.attr('value') || '').trim();
    const label = cleanText($option.text());

    if (!id && !label) {
      return;
    }

    semesters.push({
      id,
      title: label || '未命名学期',
      label: label || '未命名学期',
      selected: Boolean($option.attr('selected'))
    });
  });

  return semesters;
}

async function fetchSchedule(client, options = {}) {
  const indexResponse = await client.get(EDU_CONFIG.scheduleIndexPath, {
    validateStatus(status) {
      return status >= 200 && status < 300;
    }
  });
  const indexHtml = String(indexResponse.data || '');
  const idsMatch = indexHtml.match(/bg\.form\.addInput\(form,\s*"ids",\s*"([^"]+)"\)/);

  if (!idsMatch) {
    throw new Error('无法定位学生课表参数');
  }

  const semesterMatch = indexHtml.match(/name="semester\.id"\s+value="([^"]*)"/);
  const semesters = parseSemesters(indexHtml);
  const currentSemesterId = getCurrentSemesterId(indexHtml) || (semesterMatch ? semesterMatch[1] : '');
  const requestedSemesterId = String(options.semesterId || '').trim();
  const semesterId = requestedSemesterId || currentSemesterId;
  const tablePayload = new URLSearchParams({
    ids: idsMatch[1],
    'semester.id': semesterId,
    'setting.kind': 'std',
    startWeek: ''
  });

  const response = await client.post(EDU_CONFIG.scheduleTablePath, tablePayload.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    validateStatus(status) {
      return status >= 200 && status < 300;
    }
  });

  return {
    html: response.data,
    semesters: semesters.map((semester) => ({
      ...semester,
      selected: semester.id === semesterId
    })),
    selectedSemesterId: semesterId
  };
}

function parseJsStringLiteral(value) {
  const text = String(value || '').trim();

  if (!text || text === 'null') {
    return '';
  }

  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return text.slice(1, -1);
    }
  }

  if (text.startsWith("'")) {
    return text.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }

  return '';
}

function splitJsArguments(argsText) {
  const args = [];
  let current = '';
  let quote = '';
  let depth = 0;
  let escaped = false;

  for (const char of argsText) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

function extractTeacherNames(html, activityPosition) {
  const prefix = html.slice(Math.max(0, activityPosition - 1800), activityPosition);
  const matches = [...prefix.matchAll(/var\s+actTeachers\s*=\s*\[([\s\S]*?)\];/g)];
  const latest = matches[matches.length - 1];

  if (!latest) {
    return '';
  }

  return [...latest[1].matchAll(/name\s*:\s*"((?:\\.|[^"\\])*)"/g)]
    .map((match) => parseJsStringLiteral(`"${match[1]}"`))
    .filter(Boolean)
    .join(',');
}

function getCourseName(rawName) {
  return String(rawName || '')
    .replace(/\([0-9A-Za-z.]+\)$/, '')
    .trim();
}

function parseWeekRange(weekText) {
  const weeks = [];
  const matches = String(weekText || '')
    .replace(/周/g, '')
    .match(/\d+\s*(?:-\s*\d+)?/g) || [];

  for (const match of matches) {
    const [startText, endText] = match.split('-').map((item) => item.trim());
    const start = Number(startText);
    const end = Number(endText || startText);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      weeks.push(week);
    }
  }

  return [...new Set(weeks)].sort((a, b) => a - b);
}

function takeTrailingParenthesized(text) {
  const source = String(text || '').trim();
  const match = source.match(/\s*\(([^()]*)\)\s*$/);

  if (!match) {
    return {
      rest: source,
      value: ''
    };
  }

  return {
    rest: source.slice(0, match.index).trim(),
    value: match[1].trim()
  };
}

function parseCourseInfoText(rawText) {
  let rest = String(rawText || '').trim().replace(/^\{|\}$/g, '');
  const info = {
    name: getCourseName(rest),
    teacher: '',
    location: '',
    weeks: []
  };
  const weekLocation = takeTrailingParenthesized(rest);

  if (weekLocation.value && /^[0-9,\-\s周]+[,，]/.test(weekLocation.value)) {
    const parts = weekLocation.value.split(/[,，]/);
    info.weeks = parseWeekRange(parts.shift());
    info.location = parts.join('，').trim();
    rest = weekLocation.rest;
  }

  const teacher = takeTrailingParenthesized(rest);

  if (teacher.value && !/^[0-9A-Za-z.]+$/.test(teacher.value)) {
    info.teacher = teacher.value;
    rest = teacher.rest;
  }

  info.name = getCourseName(rest);

  return info;
}

function getWeekNumbers(validWeeks, from, startWeek, endWeek) {
  if (!validWeeks) {
    return [];
  }

  let rotatedWeeks = validWeeks;

  if (from > 1) {
    const before = validWeeks.substring(0, from - 1);
    rotatedWeeks = validWeeks.substring(from - 1);

    if (before.includes('1')) {
      rotatedWeeks += before;
    }

    while (rotatedWeeks.length < validWeeks.length) {
      rotatedWeeks += '0';
    }
  }

  const weeks = [];

  for (let week = startWeek; week <= endWeek; week += 1) {
    if (rotatedWeeks.charAt(week - 1) === '1') {
      weeks.push(week);
    }
  }

  return weeks;
}

function splitContinuousSections(sections) {
  const sorted = [...new Set(sections)].sort((a, b) => a - b);
  const groups = [];

  for (const section of sorted) {
    const latest = groups[groups.length - 1];

    if (!latest || latest[latest.length - 1] + 1 !== section) {
      groups.push([section]);
    } else {
      latest.push(section);
    }
  }

  return groups;
}

function parseSchedule(scheduleHtml) {
  const html = String(scheduleHtml || '');
  const $ = cheerio.load(html);
  const term = $('h3[align="center"]').first().text().trim() || $('h3').first().text().trim() || '本学期';
  const marshalMatch = html.match(/\.marshalTable\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/);
  const from = marshalMatch ? Number(marshalMatch[1]) : 1;
  const startWeek = marshalMatch ? Number(marshalMatch[2]) : 1;
  const endWeek = marshalMatch ? Number(marshalMatch[3]) : 25;
  const unitCountMatch = html.match(/var\s+unitCount\s*=\s*(\d+)/);
  const unitCount = unitCountMatch ? Number(unitCountMatch[1]) : 13;
  const courses = [];
  const activityRegex = /activity\s*=\s*new\s+TaskActivity\(([\s\S]*?)\);\s*((?:\s*index\s*=\s*\d+\s*\*\s*unitCount\s*\+\s*\d+\s*;\s*table\d+\.activities\[index\]\[table\d+\.activities\[index\]\.length\]\s*=\s*activity\s*;\s*)+)/g;
  let match;

  while ((match = activityRegex.exec(html)) !== null) {
    const args = splitJsArguments(match[1]);
    const rawCourseName = parseJsStringLiteral(args[3]);
    const parsedCourseInfo = parseCourseInfoText(rawCourseName);
    const name = parsedCourseInfo.name || getCourseName(rawCourseName);
    const roomName = parseJsStringLiteral(args[5]) || parsedCourseInfo.location;
    const validWeeks = parseJsStringLiteral(args[6]);
    const teacherName = extractTeacherNames(html, match.index) || parseJsStringLiteral(args[1]) || parsedCourseInfo.teacher;
    const weeks = getWeekNumbers(validWeeks, from, startWeek, endWeek);
    const activeWeeks = weeks.length > 0 ? weeks : parsedCourseInfo.weeks;
    const slotsByDay = new Map();

    for (const slot of match[2].matchAll(/index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g)) {
      const weekday = Number(slot[1]) + 1;
      const section = Number(slot[2]) + 1;
      const sections = slotsByDay.get(weekday) || [];
      sections.push(section);
      slotsByDay.set(weekday, sections);
    }

    for (const [weekday, sections] of slotsByDay.entries()) {
      for (const sectionGroup of splitContinuousSections(sections)) {
        courses.push({
          id: `${courses.length + 1}`,
          name,
          teacher: teacherName,
          location: roomName,
          weekday,
          sections: sectionGroup,
          weeks: activeWeeks
        });
      }
    }
  }

  return {
    term,
    courses: courses.sort((a, b) => {
      if (a.weekday !== b.weekday) {
        return a.weekday - b.weekday;
      }

      return (a.sections[0] || 0) - (b.sections[0] || 0);
    })
  };
}

function getCellByLabels(row, labels) {
  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const match = Object.entries(row).find(([key]) => {
      const normalizedKey = normalizeLabel(key);
      return normalizedKey === normalizedLabel ||
        normalizedKey.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedKey);
    });

    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}

function getStrictCellByLabels(row, labels) {
  const entries = Object.entries(row || {});

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel);

    if (exact && exact[1]) {
      return exact[1];
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key);

      if (normalizedLabel === '课程' && normalizedKey !== '课程') {
        return false;
      }

      return normalizedKey.includes(normalizedLabel) || normalizedLabel.includes(normalizedKey);
    });

    if (fuzzy && fuzzy[1]) {
      return fuzzy[1];
    }
  }

  return '';
}

function getGradeCellByLabels(row, labels, options = {}) {
  const entries = Object.entries(row || {});
  const negativePattern = options.exclude ? new RegExp(options.exclude) : null;

  function canUseKey(key) {
    const normalizedKey = normalizeLabel(key);

    return !negativePattern || !negativePattern.test(normalizedKey);
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel);

    if (exact && exact[1] && canUseKey(exact[0])) {
      return exact[1];
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label);
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key);

      return canUseKey(key) &&
        normalizedKey.includes(normalizedLabel) &&
        !normalizedLabel.includes(normalizedKey);
    });

    if (fuzzy && fuzzy[1]) {
      return fuzzy[1];
    }
  }

  return '';
}

function isCourseCategoryText(value) {
  return /^(必修课?|选修课?|限选课?|任选课?|公选课?|通识课?|实践课?|专业必修|专业选修|公共必修)$/u.test(cleanText(value));
}

function isBadCourseName(value) {
  const text = cleanText(value);

  return !text ||
    isCourseCategoryText(text) ||
    /^(课程名称|课程类别|课程性质|课程属性|成绩|学分|绩点)$/u.test(text) ||
    /^\d+(?:\.\d+)?$/.test(text);
}

function getGradeCourseName(row) {
  const entries = Object.entries(row || {});
  const exactLabels = ['课程名称', '课程名', '科目名称', '考试课程', '教学班名称'];

  for (const label of exactLabels) {
    const normalizedLabel = normalizeLabel(label);
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel);

    if (exact && !isBadCourseName(exact[1])) {
      return exact[1];
    }
  }

  const nameLike = entries.find(([key, value]) => {
    const normalizedKey = normalizeLabel(key);

    return /名称|课程名|科目/.test(normalizedKey) &&
      !/类别|性质|属性|序号|代码|编号|学分|成绩|绩点/.test(normalizedKey) &&
      !isBadCourseName(value);
  });

  if (nameLike) {
    return nameLike[1];
  }

  const cells = row && Array.isArray(row.__cells) ? row.__cells : [];
  const fallback = cells
    .filter((cell) => !isBadCourseName(cell))
    .filter((cell) => !/20\d{2}\s*-\s*20\d{2}|第?[一二12]学期|已修|通过/.test(cell))
    .sort((a, b) => b.length - a.length)[0];

  return fallback || '';
}

function extractTableRows(html) {
  const $ = cheerio.load(String(html || ''));
  const rows = [];

  $('table').each((tableIndex, table) => {
    let headers = [];

    $(table).find('tr').each((rowIndex, row) => {
      const cells = $(row)
        .find('th,td')
        .map((cellIndex, cell) => cleanText($(cell).text()))
        .get();
      const nonEmptyCells = cells.filter(Boolean);

      if (nonEmptyCells.length === 0) {
        return;
      }

      const hasHeaderCell = $(row).find('th').length > 0;
      const looksLikeHeader = nonEmptyCells.some((cell) => /课程|成绩|学分|绩点|考试|时间|地点|座位|学期/.test(cell));

      if ((hasHeaderCell || headers.length === 0) && looksLikeHeader) {
        headers = cells.map((cell, index) => cell || `列${index + 1}`);
        return;
      }

      if (headers.length === 0 || nonEmptyCells.length < 2) {
        return;
      }

      const data = {};

      cells.forEach((cell, index) => {
        data[headers[index] || `列${index + 1}`] = cell;
      });
      Object.defineProperty(data, '__cells', {
        value: cells,
        enumerable: false
      });
      Object.defineProperty(data, '__headers', {
        value: headers,
        enumerable: false
      });

      rows.push(data);
    });
  });

  return rows;
}

function toNumber(value) {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);

  return match ? Number(match[0]) : 0;
}

function getNumericScore(value) {
  const text = String(value || '').trim();

  if (/^(优秀|优)$/u.test(text)) {
    return 95;
  }

  if (/^良好?$/u.test(text)) {
    return 85;
  }

  if (/^中等?$/u.test(text)) {
    return 75;
  }

  if (/^及格$/u.test(text)) {
    return 60;
  }

  if (/^(不及格|缺考|缓考|作弊)$/u.test(text)) {
    return 0;
  }

  return toNumber(text);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value) || value <= 0) {
    return '--';
  }

  return Number(value.toFixed(digits)).toString();
}

function calculateGpa(score, sourceGpa) {
  const numericScore = getNumericScore(score);

  if (numericScore < 60) {
    return {
      value: 0,
      text: '--'
    };
  }

  const existingGpa = toNumber(sourceGpa);
  const gpa = existingGpa > 0 ? existingGpa : (numericScore - 50) / 10;

  return {
    value: gpa,
    text: formatNumber(gpa, 1)
  };
}

function extractGradeRecords(gradesHtml, defaultTerm = '') {
  const rows = extractTableRows(gradesHtml);
  const records = [];

  for (const row of rows) {
    const name = getGradeCourseName(row);
    const score = getGradeCellByLabels(row, ['最终成绩', '总评成绩', '总评', '成绩'], {
      exclude: '绩点|学分'
    });

    if (!name || !score || isBadCourseName(name)) {
      continue;
    }

    records.push({
      term: getStrictCellByLabels(row, ['学年学期', '开课学期', '学期', '学年']) || defaultTerm || '未分组学期',
      name,
      credit: getGradeCellByLabels(row, ['学分', '课程学分'], {
        exclude: '成绩|绩点'
      }),
      score,
      gpa: getGradeCellByLabels(row, ['绩点', '课程绩点'], {
        exclude: '成绩|学分'
      })
    });
  }

  return records;
}

function buildGradesResult(records) {
  const semesters = new Map();
  const seen = new Set();
  const groupedRecordKeys = new Set(
    records
      .filter((record) => record.term && record.term !== '未分组学期')
      .map((record) => [record.name, record.credit, record.score, record.gpa].join('|'))
  );
  let totalCredit = 0;
  let weightedScore = 0;
  let weightedGpa = 0;
  let scoreCredit = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  let gpaCredit = 0;

  for (const record of records) {
    const basicKey = [record.name, record.credit, record.score, record.gpa].join('|');

    if ((!record.term || record.term === '未分组学期') && groupedRecordKeys.has(basicKey)) {
      continue;
    }

    const uniqueKey = [record.term, record.name, record.credit, record.score, record.gpa].join('|');

    if (seen.has(uniqueKey)) {
      continue;
    }

    seen.add(uniqueKey);

    const term = record.term || '未分组学期';
    const creditText = record.credit;
    const gpaText = record.gpa;
    const credit = toNumber(creditText);
    const numericScore = getNumericScore(record.score);
    const scoreLow = numericScore > 0 && numericScore < 60;
    const gpa = calculateGpa(record.score, gpaText);
    const grade = {
      name: record.name,
      credit: creditText || '--',
      score: record.score,
      scoreLow,
      gpa: gpa.text
    };

    if (!semesters.has(term)) {
      semesters.set(term, {
        id: `semester-${semesters.size + 1}`,
        title: term,
        creditValue: 0,
        scoreValue: 0,
        scoreCredit: 0,
        scoreSum: 0,
        scoreCount: 0,
        gpaValue: 0,
        gpaCredit: 0,
        grades: []
      });
    }

    const semester = semesters.get(term);
    semester.grades.push(grade);
    semester.creditValue += credit;

    if (credit > 0) {
      totalCredit += credit;

      if (numericScore > 0) {
        semester.scoreValue += numericScore * credit;
        semester.scoreCredit += credit;
        weightedScore += numericScore * credit;
        scoreCredit += credit;
        semester.scoreSum += numericScore;
        semester.scoreCount += 1;
        scoreSum += numericScore;
        scoreCount += 1;
      }

      if (gpa.value > 0) {
        semester.gpaValue += gpa.value * credit;
        semester.gpaCredit += credit;
        weightedGpa += gpa.value * credit;
        gpaCredit += credit;
      }
    }
  }

  const semesterList = [...semesters.values()].map((semester, index) => ({
    id: semester.id,
    title: semester.title,
    credit: formatNumber(semester.creditValue, 1),
    average: formatNumber(semester.scoreValue / semester.scoreCredit, 2),
    gpa: formatNumber(semester.gpaValue / semester.gpaCredit, 2),
    expanded: index === 0,
    grades: semester.grades
  }));

  return {
    summary: [
      { label: '总学分', value: formatNumber(totalCredit, 1) },
      { label: '平均分', value: formatNumber(weightedScore / scoreCredit, 2) },
      { label: '绩点', value: formatNumber(weightedGpa / gpaCredit, 2) }
    ],
    semesters: semesterList
  };
}

function parseGrades(gradesHtml, defaultTerm = '') {
  return buildGradesResult(extractGradeRecords(gradesHtml, defaultTerm));
}

function mergeGradePages(pages) {
  const records = [];

  for (const page of pages) {
    records.push(...extractGradeRecords(page.html, page.term));
  }

  return buildGradesResult(records);
}

function parseGradeSemesters(gradesHtml) {
  const html = String(gradesHtml || '');
  const $ = cheerio.load(html);
  const semesters = [];

  function addSemester(id, label) {
    const semesterId = String(id || '').trim();

    if (!semesterId || semesters.some((semester) => semester.id === semesterId)) {
      return;
    }

    semesters.push({
      id: semesterId,
      label: cleanText(label) || `学期 ${semesterId}`
    });
  }

  $('select[name="semesterId"] option, select[name="semester.id"] option').each((index, option) => {
    const $option = $(option);
    addSemester($option.attr('value'), $option.text());
  });

  $('a[href], area[href]').each((index, element) => {
    const $element = $(element);
    const href = $element.attr('href') || '';
    const match = href.match(/[?&]semesterId=([^&#]+)/);

    if (match) {
      addSemester(decodeURIComponent(match[1]), $element.text() || $element.attr('title'));
    }
  });

  $('[onclick]').each((index, element) => {
    const $element = $(element);
    const onclick = $element.attr('onclick') || '';
    const match = onclick.match(/semesterId\s*[=:]\s*['"]?(\d+)/) ||
      onclick.match(/[?&]semesterId=(\d+)/);

    if (match) {
      addSemester(match[1], $element.text() || $element.attr('title'));
    }
  });

  for (const match of html.matchAll(/semesterId\s*[=:]\s*['"]?(\d+)/g)) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(html.length, match.index + 160);
    const label = getTextFromHtml(html.slice(start, end))
      .match(/20\d{2}\s*-\s*20\d{2}\s*(?:学年)?\s*(?:第?[一二12]学期|学期[一二12])?/);

    addSemester(match[1], label ? label[0] : '');
  }

  return semesters;
}

async function fetchEduPath(client, path) {
  const normalizedPath = normalizeEduHref(path);

  if (!normalizedPath) {
    return '';
  }

  const response = await client.get(normalizedPath, {
    validateStatus(status) {
      return status >= 200 && status < 400;
    }
  });
  const html = String(response.data || '');

  if (!html || html.includes('loginForm') || html.includes('请输入用户名')) {
    return '';
  }

  return html;
}

function extractDateText(value) {
  const text = String(value || '');
  const match = text.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/) ||
    text.match(/\d{1,2}\s*[月/-]\s*\d{1,2}\s*日?/);

  return match ? match[0].replace(/年|月/g, '-').replace(/日/g, '').replace(/\s+/g, '') : '';
}

function extractTimeText(value) {
  const text = String(value || '');
  const match = text.match(/\d{1,2}:\d{2}\s*(?:[-~至]\s*\d{1,2}:\d{2})?/);

  return match ? match[0].replace(/\s+/g, '') : '';
}

function parseExams(examHtml) {
  const rows = extractTableRows(examHtml);
  const exams = [];

  for (const row of rows) {
    const name = getCellByLabels(row, ['课程名称', '课程', '考试课程', '科目']);
    const status = getCellByLabels(row, ['状态', '安排状态', '考试状态']);
    const rawDate = getCellByLabels(row, ['考试日期', '日期']);
    const rawTime = getCellByLabels(row, ['考试时间', '时间', '起止时间']);
    const dateTime = [rawDate, rawTime, Object.values(row).join(' ')].filter(Boolean).join(' ');
    const date = extractDateText(dateTime);
    const time = extractTimeText(dateTime) || cleanText(rawTime);
    const location = getCellByLabels(row, ['考试地点', '地点', '考场', '教室']);
    const seat = getCellByLabels(row, ['座位号', '座位', '准考证号']);

    if (!name || /课程名称|考试课程/.test(name)) {
      continue;
    }

    if (/未安排|未发布|取消/.test(status)) {
      continue;
    }

    if (!date && !time && !location) {
      continue;
    }

    exams.push({
      id: `exam-${exams.length + 1}`,
      name,
      date,
      time: time || [date, rawTime].filter(Boolean).join(' '),
      dateTime: [date, time].filter(Boolean).join(' '),
      location: location || '地点待定',
      seat,
      status: status || '已安排'
    });
  }

  return exams;
}

async function fetchProfile(client, homeHtml, studentId) {
  const fallbackProfile = parseProfile(homeHtml, studentId);
  const profileHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['学籍信息', '个人信息', '基本信息'],
    [
      '/eams/stdDetail.action',
      '/eams/stdDetail!info.action',
      '/eams/home.action'
    ]
  );

  return profileHtml ? mergeProfile(fallbackProfile, profileHtml, studentId) : fallbackProfile;
}

async function fetchGrades(client, homeHtml) {
  const gradesHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['我的成绩', '成绩查询', '成绩'],
    [
      '/eams/teach/grade/course/person.action',
      '/eams/teach/grade/course/person!search.action?semesterId=&projectType=',
      '/eams/teach/grade/course/person!historyCourseGrade.action?projectType=MAJOR'
    ]
  );

  if (!gradesHtml) {
    return {
      summary: [
        { label: '总学分', value: '--' },
        { label: '平均分', value: '--' },
        { label: '绩点', value: '--' }
      ],
      semesters: []
    };
  }

  const pages = [
    { html: gradesHtml, term: '' }
  ];
  const semesters = parseGradeSemesters(gradesHtml);
  const paths = [
    '/eams/teach/grade/course/person!search.action?semesterId=&projectType=',
    '/eams/teach/grade/course/person!historyCourseGrade.action?projectType=MAJOR',
    ...semesters.flatMap((semester) => [
      `/eams/teach/grade/course/person!search.action?semesterId=${encodeURIComponent(semester.id)}&projectType=`,
      `/eams/teach/grade/course/person!search.action?semesterId=${encodeURIComponent(semester.id)}&projectType=MAJOR`
    ])
  ];
  const seenPaths = new Set();

  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);

    try {
      const html = await fetchEduPath(client, path);

      if (!html) {
        continue;
      }

      const semesterId = (path.match(/[?&]semesterId=([^&#]*)/) || [])[1] || '';
      const semester = semesters.find((item) => item.id === decodeURIComponent(semesterId));

      pages.push({
        html,
        term: semester ? semester.label : ''
      });
    } catch (error) {
      console.warn(`fetch grades page failed: ${path}`, getErrorMessage(error, ''));
    }
  }

  const result = mergeGradePages(pages);

  return result.semesters.length > 0 ? result : {
    summary: [
      { label: '总学分', value: '--' },
      { label: '平均分', value: '--' },
      { label: '绩点', value: '--' }
    ],
    semesters: []
  };
}

async function fetchExams(client, homeHtml) {
  const examHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['我的考试', '考试安排', '考试'],
    [
      '/eams/stdExamTable.action',
      '/eams/stdExamTable!examTable.action',
      '/eams/examTableForStd.action'
    ]
  );

  return examHtml ? parseExams(examHtml) : [];
}

function getOpenId() {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    throw new PublicError('微信登录状态无效，请重新进入小程序', 'NO_OPENID');
  }

  return openid;
}

function getDatabase() {
  return cloud.database();
}

function getPasswordKey() {
  const secret = process.env[PASSWORD_SECRET_ENV];

  if (!secret || secret.length < 16) {
    throw new PublicError(`云函数未配置 ${PASSWORD_SECRET_ENV}`, 'SECRET_MISSING');
  }

  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, 'hex');
  }

  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptPassword(password) {
  const key = getPasswordKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

function decryptPassword(cipherText) {
  try {
    const [version, ivText, tagText, encryptedText] = String(cipherText || '').split(':');

    if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
      throw new Error('invalid cipher');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getPasswordKey(),
      Buffer.from(ivText, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new PublicError('教务账号绑定信息已失效，请重新绑定', 'BINDING_INVALID');
  }
}

function maskStudentId(studentId) {
  const value = String(studentId || '');

  if (value.length <= 4) {
    return value;
  }

  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function isNotFoundError(error) {
  const message = String(error && error.message || '');

  return error && (
    error.code === 'DATABASE_DOCUMENT_NOT_EXIST' ||
    error.errCode === -502005 ||
    /not exist|不存在|document/i.test(message)
  );
}

async function readBinding(openid) {
  try {
    const result = await getDatabase()
      .collection(BINDING_COLLECTION)
      .doc(openid)
      .get();

    return result.data || null;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function fetchScheduleByCredentials(studentId, password, options = {}) {
  const client = createEduClient();

  const homeHtml = await loginToEduSystem(client, studentId, password);
  const scheduleResult = await fetchSchedule(client, options);
  const parsedSchedule = parseSchedule(scheduleResult.html);
  let semesters = scheduleResult.semesters;

  if (
    (scheduleResult.selectedSemesterId || parsedSchedule.term) &&
    !semesters.some((semester) => semester.id === scheduleResult.selectedSemesterId)
  ) {
    semesters = [{
      id: scheduleResult.selectedSemesterId || '',
      title: parsedSchedule.term || '当前学期',
      label: parsedSchedule.term || '当前学期',
      selected: true
    }, ...semesters];
  }

  const schedule = {
    ...parsedSchedule,
    semesters,
    selectedSemesterId: scheduleResult.selectedSemesterId
  };
  const exams = options.includeExams ? await fetchExams(client, homeHtml) : [];
  const profile = options.includeProfile ? await fetchProfile(client, homeHtml, studentId) : null;

  return {
    schedule,
    profile,
    exams
  };
}

async function fetchGradesByCredentials(studentId, password) {
  const client = createEduClient();
  const homeHtml = await loginToEduSystem(client, studentId, password);

  return fetchGrades(client, homeHtml);
}

async function saveBinding(openid, studentId, password, schedule, profile, exams = []) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = await readBinding(openid);

  await db.collection(BINDING_COLLECTION).doc(openid).set({
    data: {
      _openid: openid,
      studentId,
      passwordCipher: encryptPassword(password),
      profile,
      lastSchedule: schedule,
      lastExams: exams,
      lastGrades: existing && existing.lastGrades ? existing.lastGrades : null,
      lastFetchedAt: now,
      createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
      updatedAt: db.serverDate()
    }
  });
}

async function updateScheduleCache(openid, schedule, exams = []) {
  await getDatabase().collection(BINDING_COLLECTION).doc(openid).update({
    data: {
      lastSchedule: schedule,
      lastExams: exams,
      lastFetchedAt: new Date().toISOString(),
      updatedAt: getDatabase().serverDate()
    }
  });
}

async function updateGradesCache(openid, grades) {
  const db = getDatabase();
  const _ = db.command;

  await db.collection(BINDING_COLLECTION).doc(openid).update({
    data: {
      lastGrades: _.set(grades),
      updatedAt: db.serverDate()
    }
  });
}

function pickEditableProfileFields(profile) {
  const input = profile || {};
  const fields = [
    'name',
    'major',
    'grade',
    'level',
    'className',
    'gender',
    'birthDate',
    'politicalStatus',
    'phone',
    'email',
    'nativePlace',
    'enrollmentDate',
    'studentStatus',
    'dormitory',
    'counselor',
    'avatarUrl'
  ];
  const result = {};

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      result[field] = String(input[field] || '').trim();
    }
  }

  return result;
}

async function saveProfile(openid, profile) {
  const binding = await readBinding(openid);

  if (!binding || !binding.studentId || !binding.passwordCipher) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const savedProfile = {
    ...(binding.profile || parseProfile('', binding.studentId)),
    ...pickEditableProfileFields(profile),
    studentId: binding.studentId,
    maskedStudentId: maskStudentId(binding.studentId),
    updatedAt: new Date().toISOString()
  };

  await getDatabase().collection(BINDING_COLLECTION).doc(openid).update({
    data: {
      profile: savedProfile,
      updatedAt: getDatabase().serverDate()
    }
  });

  return savedProfile;
}

function withScheduleMeta(schedule, binding, exams = []) {
  return {
    ...schedule,
    exams,
    studentId: maskStudentId(binding.studentId),
    lastFetchedAt: new Date().toISOString()
  };
}

async function bindAccount(event) {
  const openid = getOpenId();
  const studentId = String(event.studentId || '').trim();
  const password = String(event.password || '');

  if (!studentId || !password) {
    throw new PublicError('请填写学号和密码', 'INVALID_INPUT');
  }

  const { schedule, profile, exams } = await fetchScheduleByCredentials(studentId, password, {
    includeProfile: true,
    includeExams: true
  });
  await saveBinding(openid, studentId, password, schedule, profile, exams);

  return {
    success: true,
    data: {
      ...withScheduleMeta(schedule, { studentId }, exams),
      profile
    }
  };
}

async function getBoundSchedule(event = {}) {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!binding || !binding.studentId || !binding.passwordCipher) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const password = decryptPassword(binding.passwordCipher);
  const { schedule, exams } = await fetchScheduleByCredentials(binding.studentId, password, {
    semesterId: event.semesterId,
    includeExams: true
  });
  await updateScheduleCache(openid, schedule, exams);

  return {
    success: true,
    data: withScheduleMeta(schedule, binding, exams)
  };
}

async function getBindingStatus() {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  return {
    success: true,
    data: {
      bound: Boolean(binding && binding.studentId && binding.passwordCipher),
      studentId: binding ? maskStudentId(binding.studentId) : '',
      profile: binding && binding.profile ? binding.profile : null
    }
  };
}

async function getBoundProfile() {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!binding || !binding.studentId || !binding.passwordCipher) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  return {
    success: true,
    data: {
      profile: binding.profile || parseProfile('', binding.studentId),
      studentId: maskStudentId(binding.studentId)
    }
  };
}

async function getBoundGrades() {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!binding || !binding.studentId || !binding.passwordCipher) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const grades = await fetchGradesByCredentials(binding.studentId, decryptPassword(binding.passwordCipher));
  await updateGradesCache(openid, grades);

  return {
    success: true,
    data: grades
  };
}

async function saveBoundProfile(event) {
  const openid = getOpenId();
  const profile = await saveProfile(openid, event.profile || {});

  return {
    success: true,
    data: {
      profile,
      studentId: maskStudentId(profile.studentId)
    }
  };
}

async function unbindAccount() {
  const openid = getOpenId();

  try {
    await getDatabase().collection(BINDING_COLLECTION).doc(openid).remove();
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  return {
    success: true
  };
}

async function directFetch(event) {
  const studentId = String(event.studentId || '').trim();
  const password = String(event.password || '');

  if (!studentId || !password) {
    throw new PublicError('请填写学号和密码', 'INVALID_INPUT');
  }

  const { schedule, profile, exams } = await fetchScheduleByCredentials(studentId, password, {
    includeProfile: true,
    includeExams: true,
    semesterId: event.semesterId
  });

  return {
    success: true,
    data: {
      ...schedule,
      exams,
      profile
    }
  };
}

exports.main = async (event) => {
  try {
    const input = event || {};
    const action = input.action ? String(input.action) : '';

    if (action === 'bind') {
      return await bindAccount(input);
    }

    if (action === 'status') {
      return await getBindingStatus();
    }

    if (action === 'profile') {
      return await getBoundProfile();
    }

    if (action === 'grades') {
      return await getBoundGrades();
    }

    if (action === 'saveProfile') {
      return await saveBoundProfile(input);
    }

    if (action === 'unbind') {
      return await unbindAccount();
    }

    if (action === 'direct' || input.studentId && input.password) {
      return await directFetch(input);
    }

    return await getBoundSchedule(input);
  } catch (error) {
    if (!(error instanceof PublicError)) {
      console.error('getSchedule failed:', error);
    }

    return {
      success: false,
      code: error.code || 'FETCH_FAILED',
      message: getErrorMessage(error, '课表获取失败')
    };
  }
};
