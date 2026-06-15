const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { CookieJar } = require('tough-cookie');
const { HttpCookieAgent, HttpsCookieAgent } = require('http-cookie-agent/http');
const { getErrorMessage, maskStudentId } = require('../common');
const EDU_CONFIG = {
  baseUrl: 'https://jxgl.wtbu.edu.cn',
  loginPath: '/eams/login.action',
  homePath: '/eams/home.action',
  scheduleIndexPath: '/eams/courseTableForStd.action',
  scheduleTablePath: '/eams/courseTableForStd!courseTable.action'
};

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

function formatSemesterLabel(label, schoolYear = '', termName = '') {
  const cleanLabel = cleanText(label);
  const yearText = cleanText(schoolYear).replace(/\s+/g, '');
  const rawTerm = cleanText(termName).replace(/\s+/g, '');

  if (/20\d{2}\s*[-/]\s*20\d{2}/.test(cleanLabel) && /\u5b66\u671f|[12\u4e00\u4e8c]/.test(cleanLabel)) {
    return cleanLabel.replace(/\s+/g, '');
  }

  if (!yearText) {
    return cleanLabel || rawTerm;
  }

  if (/^\d+$/.test(rawTerm) || /^[\u4e00\u4e8c]$/.test(rawTerm)) {
    return `${yearText}\u5b66\u5e74\u7b2c${rawTerm}\u5b66\u671f`;
  }

  if (/^\u5b66\u671f\s*[12\u4e00\u4e8c]$/.test(rawTerm)) {
    return `${yearText}\u5b66\u5e74\u7b2c${rawTerm.replace(/\u5b66\u671f/g, '')}\u5b66\u671f`;
  }

  if (rawTerm) {
    return `${yearText}\u5b66\u5e74${rawTerm}`;
  }

  return cleanLabel || yearText;
}

function getCurrentSemesterLabel(indexHtml) {
  const html = String(indexHtml || '');
  const $ = cheerio.load(html);
  const selectedOptionText = cleanText($('select[name="semester.id"] option[selected]').first().text());
  const inputValue = $('input')
    .map((index, input) => cleanText($(input).attr('value')))
    .get()
    .find((value) => /20\d{2}\s*[-/]\s*20\d{2}.*\u5b66\u671f/.test(value));
  const textMatch = getTextFromHtml(html).match(/20\d{2}\s*[-/]\s*20\d{2}\s*(?:\u5b66\u5e74)?\s*(?:\u7b2c?\s*[12\u4e00\u4e8c]\s*\u5b66\u671f|\u5b66\u671f\s*[12\u4e00\u4e8c])/);

  return selectedOptionText || inputValue || (textMatch ? textMatch[0] : '');
}

function addSemester(semesters, id, label, options = {}) {
  const semesterId = String(id || '').trim();
  const formattedLabel = formatSemesterLabel(label, options.schoolYear, options.termName);

  if (!semesterId || semesters.some((semester) => semester.id === semesterId)) {
    return;
  }

  semesters.push({
    id: semesterId,
    title: formattedLabel || `学期 ${semesterId}`,
    label: formattedLabel || `学期 ${semesterId}`,
    selected: Boolean(options.selected)
  });
}

function mergeSemesters(...groups) {
  const merged = [];

  groups.forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((semester) => {
      const existing = merged.find((item) => item.id === semester.id);

      if (existing) {
        existing.selected = Boolean(existing.selected || semester.selected);

        if ((!existing.label || existing.label === `学期 ${existing.id}`) && semester.label) {
          existing.label = semester.label;
          existing.title = semester.title || semester.label;
        }

        return;
      }

      if (semester && semester.id) {
        merged.push({ ...semester });
      }
    });
  });

  return merged.sort((left, right) => compareSemesterTitle(right.label, left.label));
}

function extractSemesterFromObjectLiteral(block) {
  const text = String(block || '');
  const keyPrefix = "['\"]?\\b";
  const keySuffix = "\\b['\"]?\\s*[:=]\\s*";
  const idMatch = text.match(new RegExp(`${keyPrefix}(?:semesterId|semester\\.id|id)${keySuffix}['"]?([A-Za-z0-9_.-]+)['"]?`, 'i'));
  const labelMatch = text.match(new RegExp(`${keyPrefix}(?:label|title|text|semesterName|name)${keySuffix}['"]([^'"]{1,100})['"]`, 'i'));
  const schoolYearMatch = text.match(new RegExp(`${keyPrefix}(?:schoolYear|schoolyear|year)${keySuffix}['"]?((?:19|20)\\d{2}\\s*[-/]\\s*(?:19|20)\\d{2})['"]?`, 'i'));
  const termMatch = text.match(new RegExp(`${keyPrefix}(?:term|semester|semesterType|name)${keySuffix}['"]?([^,'"};]{1,40})`, 'i'));
  const label = labelMatch ? labelMatch[1] : '';
  const schoolYear = schoolYearMatch ? schoolYearMatch[1] : '';
  const termName = termMatch ? termMatch[1] : '';

  if (!idMatch || (!label && !schoolYear && !/\u5b66\u671f|[12\u4e00\u4e8c]/.test(termName))) {
    return null;
  }

  return {
    id: idMatch[1],
    label,
    schoolYear,
    termName
  };
}

function parseSemesters(indexHtml) {
  const html = String(indexHtml || '');
  const $ = cheerio.load(html);
  const semesters = [];

  $('select[name="semester.id"] option, select[name="semesterId"] option').each((index, option) => {
    const $option = $(option);
    const id = String($option.attr('value') || '').trim();
    const label = cleanText($option.text());

    if (!id && !label) {
      return;
    }

    addSemester(semesters, id, label, {
      selected: Boolean($option.attr('selected'))
    });
  });

  $('[data-semester-id], [data-semesterid], [data-id]').each((index, element) => {
    const $element = $(element);
    const id = $element.attr('data-semester-id') || $element.attr('data-semesterid') || $element.attr('data-id');
    const label = $element.text() || $element.attr('title') || $element.attr('data-label') || '';

    if (/20\d{2}\s*[-/]\s*20\d{2}|\u5b66\u671f/.test(label)) {
      addSemester(semesters, id, label);
    }
  });

  $('a[href], area[href], [onclick]').each((index, element) => {
    const $element = $(element);
    const text = [$element.text(), $element.attr('title')].map(cleanText).filter(Boolean).join(' ');
    const source = [$element.attr('href'), $element.attr('onclick')].join(' ');
    const idMatch = source.match(/[?&](?:semesterId|semester\.id)=([^&#'"\s]+)/i) ||
      source.match(/\b(?:semesterId|semester\.id)\b\s*[=:]\s*['"]?([A-Za-z0-9_.-]+)/i);

    if (idMatch) {
      addSemester(semesters, decodeURIComponent(idMatch[1]), text);
    }
  });

  for (const match of html.matchAll(/\{[^{}]{0,800}(?:semesterId|semester\.id|schoolYear|semesterName)[^{}]{0,800}\}/gi)) {
    const parsed = extractSemesterFromObjectLiteral(match[0]);

    if (parsed) {
      addSemester(semesters, parsed.id, parsed.label, {
        schoolYear: parsed.schoolYear,
        termName: parsed.termName
      });
    }
  }

  const currentSemesterId = getCurrentSemesterId(html);

  if (currentSemesterId && !semesters.some((semester) => semester.id === currentSemesterId)) {
    addSemester(semesters, currentSemesterId, getCurrentSemesterLabel(html), { selected: true });
  }

  return mergeSemesters(
    semesters.map((semester) => ({
      ...semester,
      selected: semester.selected || semester.id === currentSemesterId
    }))
  );
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
  const semesters = mergeSemesters(parseSemesters(indexHtml), await fetchSemesterCalendar(client));
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

async function fetchSemesterCalendar(client) {
  const paths = [
    '/eams/dataQuery.action?dataType=semesterCalendar',
    '/eams/dataQuery.action?tagId=semesterCalendar&dataType=semesterCalendar'
  ];

  for (const path of paths) {
    try {
      const html = await fetchEduPath(client, path);
      const semesters = parseSemesters(html);

      if (semesters.length > 0) {
        return semesters;
      }
    } catch (error) {
      console.warn(`fetch semester calendar failed: ${path}`, getErrorMessage(error, ''));
    }
  }

  return [];
}

async function fetchSemestersWithClient(client) {
  const indexResponse = await client.get(EDU_CONFIG.scheduleIndexPath, {
    validateStatus(status) {
      return status >= 200 && status < 300;
    }
  });
  const indexHtml = String(indexResponse.data || '');
  const semesters = mergeSemesters(parseSemesters(indexHtml), await fetchSemesterCalendar(client));

  return mergeSemesters(
    semesters
    .map((semester) => ({
      ...semester,
      selected: semester.selected || semester.id === getCurrentSemesterId(indexHtml)
    }))
  );
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

function parseSemesterTitle(title) {
  const text = cleanText(title);
  const rangeMatch = text.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  const singleYearMatch = rangeMatch ? null : text.match(/(20\d{2})/);
  const startYear = rangeMatch ? Number(rangeMatch[1]) : (singleYearMatch ? Number(singleYearMatch[1]) : -1);
  const endYear = rangeMatch ? Number(rangeMatch[2]) : startYear;
  let termIndex = 0;

  if (/(?:\u7b2c?\s*2\s*\u5b66\u671f|\u5b66\u671f\s*2|\u7b2c?\s*\u4e8c\s*\u5b66\u671f|\u4e0b\u5b66\u671f|\u6625\u5b66\u671f)/.test(text)) {
    termIndex = 2;
  } else if (/(?:\u7b2c?\s*1\s*\u5b66\u671f|\u5b66\u671f\s*1|\u7b2c?\s*\u4e00\s*\u5b66\u671f|\u4e0a\u5b66\u671f|\u79cb\u5b66\u671f)/.test(text)) {
    termIndex = 1;
  }

  return {
    startYear,
    endYear,
    termIndex,
    text
  };
}

function compareSemesterTitle(left, right) {
  const leftMeta = parseSemesterTitle(left);
  const rightMeta = parseSemesterTitle(right);

  if (leftMeta.startYear !== rightMeta.startYear) {
    return leftMeta.startYear - rightMeta.startYear;
  }

  if (leftMeta.endYear !== rightMeta.endYear) {
    return leftMeta.endYear - rightMeta.endYear;
  }

  if (leftMeta.termIndex !== rightMeta.termIndex) {
    return leftMeta.termIndex - rightMeta.termIndex;
  }

  return leftMeta.text.localeCompare(rightMeta.text);
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

  const semesterList = [...semesters.values()]
    .sort((left, right) => compareSemesterTitle(right.title, left.title))
    .map((semester, index) => ({
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

const examFetchConfig = {
  examBatchFetchDelayMs: 1600
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableExamHtml(html) {
  const text = String(html || '');

  return !text ||
    text.includes('\u8bf7\u4e0d\u8981\u8fc7\u5feb\u70b9\u51fb') ||
    text.includes('\u7487\u8702\u7b09\u7470\u4f5e\u8e43\u8e47\u7089\u9366\ue102\u507c\u9351\ufffd') ||
    text.includes('loginForm') ||
    text.includes('\u8bf7\u8f93\u5165\u7528\u6237\u540d') ||
    text.includes('\u7487\u75af\u7df6\u8f93\u934f\u30e7\u657e\u93b4\u5cf0\u6080');
}

async function fetchExamBatchHtml(client, path) {
  const normalizedPath = normalizeEduHref(path);

  if (!normalizedPath) {
    return '';
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await sleep(examFetchConfig.examBatchFetchDelayMs);
    }

    try {
      const html = await fetchEduPath(client, normalizedPath);

      if (!isRetryableExamHtml(html)) {
        return html;
      }
    } catch (error) {
      console.warn(`fetch exam page failed: ${normalizedPath}`, getErrorMessage(error, ''));
    }
  }

  return '';
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

function isUnscheduledText(value) {
  return /未安排|待安排|待定/.test(String(value || ''));
}

function parseExams(examHtml, batch = {}) {
  const rows = extractTableRows(examHtml);
  const exams = [];

  for (const row of rows) {
    const name = getCellByLabels(row, ['课程名称', '课程', '考试课程', '科目']);
    const status = getCellByLabels(row, ['状态', '安排状态', '考试状态', '考试情况']);
    const rawDate = getCellByLabels(row, ['考试日期', '日期']);
    const rawTime = getCellByLabels(row, ['考试时间', '时间', '起止时间']);
    const dateTime = [rawDate, rawTime, Object.values(row).join(' ')].filter(Boolean).join(' ');
    const date = extractDateText(dateTime);
    const time = extractTimeText(dateTime) || cleanText(rawTime);
    const rawLocation = getCellByLabels(row, ['考试地点', '地点', '考场', '教室']);
    const rawSeat = getCellByLabels(row, ['座位号', '座位', '准考证号']);
    const isUnscheduled = isUnscheduledText([rawDate, rawTime, rawLocation, rawSeat, status].join(' '));

    if (!name || /课程名称|考试课程/.test(name)) {
      continue;
    }

    if (/未发布|取消/.test(status)) {
      continue;
    }

    if (!date && !time && !isUnscheduled) {
      continue;
    }

    exams.push({
      id: `exam-${exams.length + 1}`,
      batchId: batch.id || '',
      batchName: batch.name || '',
      name,
      date,
      time: isUnscheduled ? '' : time || [date, rawTime].filter(Boolean).join(' '),
      dateTime: [date, isUnscheduled ? '' : time].filter(Boolean).join(' '),
      location: isUnscheduled || isUnscheduledText(rawLocation) ? '' : rawLocation,
      seat: isUnscheduled || isUnscheduledText(rawSeat) ? '' : rawSeat,
      status: isUnscheduled ? '未安排' : status || '已安排'
    });
  }

  return exams;
}

function getExamContentKey(exam) {
  return [
    exam.name,
    exam.date,
    exam.time,
    exam.location,
    exam.seat
  ].join('|');
}

function getExamBatchKey(exam) {
  return exam.batchId || exam.batchName || '';
}

function getExamKey(exam) {
  return [
    getExamBatchKey(exam),
    getExamContentKey(exam)
  ].join('|');
}

function mergeExams(examGroups) {
  const exams = [];
  const indexByKey = new Map();
  const unbatchedKeyByContent = new Map();

  for (const group of examGroups) {
    for (const exam of group) {
      const key = getExamKey(exam);
      const contentKey = getExamContentKey(exam);
      const batchKey = getExamBatchKey(exam);

      if (indexByKey.has(key)) {
        const existing = exams[indexByKey.get(key)];

        if (existing && !existing.batchId && exam.batchId) {
          Object.assign(existing, exam, { id: existing.id });
        }

        continue;
      }

      if (batchKey && unbatchedKeyByContent.has(contentKey)) {
        const unbatchedKey = unbatchedKeyByContent.get(contentKey);
        const index = indexByKey.get(unbatchedKey);

        if (index !== undefined) {
          exams[index] = {
            ...exam,
            id: exams[index].id
          };
          indexByKey.delete(unbatchedKey);
          indexByKey.set(key, index);
          unbatchedKeyByContent.delete(contentKey);
          continue;
        }
      }

      const item = {
        ...exam,
        id: `exam-${exams.length + 1}`
      };
      exams.push(item);
      indexByKey.set(key, exams.length - 1);

      if (!batchKey) {
        unbatchedKeyByContent.set(contentKey, key);
      }
    }
  }

  return exams;
}

function getExamBatchPaths(batch) {
  const id = String(batch && batch.id || '').trim();
  const paths = [batch && batch.path];

  if (id) {
    paths.push(
      `/eams/stdExamTable!examTable.action?examBatch.id=${encodeURIComponent(id)}`,
      `/eams/stdExamTable.action?examBatch.id=${encodeURIComponent(id)}`,
      `/eams/examTableForStd.action?examBatch.id=${encodeURIComponent(id)}`
    );
  }

  return [...new Set(paths.map(normalizeEduHref).filter(Boolean))];
}

function findExamBatches(examHtml) {
  const html = String(examHtml || '');
  const $ = cheerio.load(html);
  const batches = [];
  const seen = new Set();

  function addBatch(value, label = '', path = '', selected = false) {
    const id = String(value || '').trim();
    const href = path ? normalizeEduHref(path) : '';

    if ((!id || !/^\d+$/.test(id)) && !href) {
      return;
    }

    const normalizedPath = href || normalizeEduHref(`/eams/stdExamTable!examTable.action?examBatch.id=${id}`);
    const key = id || normalizedPath;

    if (!normalizedPath || seen.has(key)) {
      return;
    }

    seen.add(key);
    batches.push({
      id,
      name: cleanText(label),
      path: normalizedPath,
      selected: Boolean(selected)
    });
  }

  $('select').each((index, select) => {
    const $select = $(select);
    const hint = [$select.attr('name'), $select.attr('id'), $select.attr('class')].join(' ');

    $select.find('option').each((optionIndex, option) => {
      const $option = $(option);
      const label = cleanText($option.text());

      if (/examBatch|考试|批次/.test(`${hint} ${label}`)) {
        addBatch($option.attr('value'), label, '', $option.attr('selected'));
      }
    });
  });

  $('input[name="examBatch.id"]').each((index, element) => {
    addBatch($(element).attr('value'), $(element).attr('title') || $(element).attr('data-label'));
  });

  $('a[href], area[href]').each((index, element) => {
    const $element = $(element);
    const href = $(element).attr('href') || '';
    const match = href.match(/[?&]examBatch\.id=(\d+)/);

    if (match) {
      addBatch(match[1], $element.text() || $element.attr('title'), href);
      return;
    }

    if (/stdExamTable!examTable\.action/.test(href)) {
      addBatch('', $element.text() || $element.attr('title'), href);
    }
  });

  $('[onclick]').each((index, element) => {
    const $element = $(element);
    const onclick = $(element).attr('onclick') || '';
    const match = onclick.match(/[?&]examBatch\.id=(\d+)/) ||
      onclick.match(/examBatch\.id\s*[=:]\s*['"]?(\d+)/);

    if (match) {
      addBatch(match[1], $element.text() || $element.attr('title'));
    }
  });

  for (const match of html.matchAll(/examBatch\.id\s*[=:]\s*['"]?(\d+)/g)) {
    addBatch(match[1]);
  }

  return batches;
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

  if (!examHtml) {
    return [];
  }

  const batches = findExamBatches(examHtml);
  const selectedBatch = batches.find((batch) => batch.selected) || batches[0] || {};
  const selectedBatchKey = getExamBatchKey(selectedBatch) || normalizeEduHref(selectedBatch.path);
  const selectedExams = parseExams(examHtml, selectedBatch);
  const parsedBatchKeys = new Set();

  if (selectedExams.length > 0 && selectedBatchKey) {
    parsedBatchKeys.add(selectedBatchKey);
  }

  const batchesToFetch = batches.filter((batch) => {
    const batchKey = getExamBatchKey(batch) || normalizeEduHref(batch.path);

    return Boolean(batchKey) && !parsedBatchKeys.has(batchKey);
  });
  const examGroups = [selectedExams];

  for (const batch of batchesToFetch) {
    await sleep(examFetchConfig.examBatchFetchDelayMs);

    for (const path of getExamBatchPaths(batch)) {
      const html = await fetchExamBatchHtml(client, path);

      if (html) {
        examGroups.push(parseExams(html, batch));
        break;
      }
    }
  }

  return mergeExams(examGroups);
}

async function fetchScheduleWithClient(client, homeHtml, studentId, options = {}) {
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

async function fetchScheduleByCredentials(studentId, password, options = {}) {
  const client = createEduClient();
  const homeHtml = await loginToEduSystem(client, studentId, password);

  return fetchScheduleWithClient(client, homeHtml, studentId, options);
}

async function fetchSemestersByCredentials(studentId, password) {
  const client = createEduClient();

  await loginToEduSystem(client, studentId, password);

  return fetchSemestersWithClient(client);
}

async function fetchGradesByCredentials(studentId, password) {
  const client = createEduClient();
  const homeHtml = await loginToEduSystem(client, studentId, password);

  return fetchGrades(client, homeHtml);
}

async function fetchAllByCredentials(studentId, password, options = {}) {
  const client = createEduClient();
  const homeHtml = await loginToEduSystem(client, studentId, password);
  const scheduleResult = await fetchScheduleWithClient(client, homeHtml, studentId, {
    includeExams: true,
    includeProfile: Boolean(options.includeProfile),
    semesterId: options.semesterId
  });
  const grades = await fetchGrades(client, homeHtml);

  return {
    ...scheduleResult,
    grades
  };
}

function createDefaultProfile(studentId) {
  return parseProfile('', studentId);
}

module.exports = {
  id: 'wtbu',
  name: '武汉工商学院',
  aliases: ['武汉工商学院', '武工商', 'WTBU', 'wtbu'],
  eduSystemUrl: `${EDU_CONFIG.baseUrl}${EDU_CONFIG.homePath}`,
  fetchScheduleByCredentials,
  fetchSemestersByCredentials,
  fetchGradesByCredentials,
  fetchAllByCredentials,
  createDefaultProfile,
  __test__: {
    buildGradesResult,
    extractGradeRecords,
    fetchExams,
    findExamBatches,
    getExamBatchPaths,
    mergeGradePages,
    mergeExams,
    parseSemesters,
    parseGrades,
    parseExams,
    parseSchedule,
    setExamBatchFetchDelayMs(ms) {
      examFetchConfig.examBatchFetchDelayMs = Math.max(0, Number(ms) || 0);
    }
  }
};
