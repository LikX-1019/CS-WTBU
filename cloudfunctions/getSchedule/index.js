const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { PublicError, getErrorMessage, maskStudentId } = require('./common');
const {
  DEFAULT_SCHOOL_ID,
  getSchool,
  listSchools,
  toPublicSchool
} = require('./schools');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const BINDING_COLLECTION = 'eduAccountBindings';
const FEEDBACK_COLLECTION = 'feedbackItems';
const TERM_WEEK_CONFIG_COLLECTION = 'termWeekConfigs';
const TERM_WEEK_REPORT_COLLECTION = 'termWeekReports';
const PASSWORD_SECRET_ENV = 'EDU_PASSWORD_SECRET';
const ADMIN_OPENIDS_ENV = 'ADMIN_OPENIDS';
const CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 3;
const TERM_WEEK_REPORT_TARGET = 10;
const TERM_WEEK_MAX_WEEK = 20;
const MIN_TERM_SEMESTER_START_YEAR = 2025;
const ensuredCollections = new Set();
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

function getAdminOpenIds() {
  return String(process.env[ADMIN_OPENIDS_ENV] || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAdminOpenId(openid) {
  return getAdminOpenIds().includes(openid);
}

function assertAdmin() {
  const openid = getOpenId();

  if (!isAdminOpenId(openid)) {
    throw new PublicError('暂无管理员权限', 'FORBIDDEN');
  }

  return openid;
}

function sanitizeText(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength);
}

function toDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTimeText(value) {
  const date = toDate(value);

  if (!date) {
    return '';
  }

  return `${date.getMonth() + 1}-${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateText(value) {
  const date = toDate(value);

  if (!date) {
    return '';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getSemesterStartYear(value) {
  const text = String(value || '');
  const rangeMatch = text.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  const singleYearMatch = rangeMatch ? null : text.match(/(20\d{2})/);

  if (rangeMatch) {
    return Number(rangeMatch[1]);
  }

  if (singleYearMatch) {
    return Number(singleYearMatch[1]);
  }

  return -1;
}

function isAllowedSemesterOption(semesterId, label, term) {
  const startYear = getSemesterStartYear([label, term, semesterId].filter(Boolean).join(' '));

  return startYear < 0 || startYear >= MIN_TERM_SEMESTER_START_YEAR;
}

function parseSemesterTitle(value) {
  const text = String(value || '').replace(/\s+/g, '');
  const rangeMatch = text.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  const singleYearMatch = rangeMatch ? null : text.match(/(20\d{2})/);
  const startYear = rangeMatch ? Number(rangeMatch[1]) : (singleYearMatch ? Number(singleYearMatch[1]) : -1);
  const endYear = rangeMatch ? Number(rangeMatch[2]) : startYear;
  let termIndex = 0;

  if (/(?:第?\s*2\s*学期|学期\s*2|第?\s*二\s*学期|下学期|春学期)/.test(text)) {
    termIndex = 2;
  } else if (/(?:第?\s*1\s*学期|学期\s*1|第?\s*一\s*学期|上学期|秋学期)/.test(text)) {
    termIndex = 1;
  }

  return {
    startYear,
    endYear,
    termIndex
  };
}

function normalizeSemesterLabel(label) {
  const text = sanitizeText(label, 120).replace(/\s+/g, '');
  const meta = parseSemesterTitle(text);
  const termName = meta.termIndex === 1 ? '一' : (meta.termIndex === 2 ? '二' : '');

  if (meta.startYear > 0 && meta.endYear > 0 && termName) {
    return `${meta.startYear}-${meta.endYear}学年第${termName}学期`;
  }

  return text;
}

function getSemesterCanonicalKey(schoolId, semesterId, label, term) {
  const meta = parseSemesterTitle([label, term].filter(Boolean).join(' '));
  const normalizedSchoolId = sanitizeText(schoolId, 80) || DEFAULT_SCHOOL_ID;

  if (meta.startYear > 0 && meta.endYear > 0 && meta.termIndex > 0) {
    return `${normalizedSchoolId}_${meta.startYear}-${meta.endYear}-${meta.termIndex}`;
  }

  return getTermWeekConfigId(normalizedSchoolId, semesterId);
}

function parseDateText(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);

  return value;
}

function isCollectionMissingError(error) {
  const code = String(error && (error.code || error.errCode || '') || '');
  const message = String(error && (error.message || error.errMsg) || '');

  return code === 'DB_TABLE_COLLECTION_NOT_EXIST' ||
    code === 'DATABASE_COLLECTION_NOT_EXIST' ||
    code === '-502005' ||
    /DB_TABLE_COLLECTION_NOT_EXIST|ResourceNotFound/i.test(message) ||
    /collection|table|db|集合|数据表/i.test(message) && /not exist|not exists|不存在|not found/i.test(message);
}

function isCollectionExistsError(error) {
  const code = String(error && (error.code || error.errCode || '') || '');
  const message = String(error && (error.message || error.errMsg) || '');

  return code === 'DATABASE_COLLECTION_ALREADY_EXISTS' ||
    code === '-5010' ||
    code === 'RESOURCE_UNAVAILABLE' ||
    /resourceunavailable/i.test(message) && /table exist|already exist|already exists/i.test(message) ||
    /already exists|already exist|已存在/i.test(message);
}

async function ensureCollectionExists(collectionName) {
  if (ensuredCollections.has(collectionName)) {
    return;
  }

  const db = getDatabase();

  if (typeof db.createCollection !== 'function') {
    return;
  }

  try {
    await db.createCollection(collectionName);
  } catch (error) {
    if (!isCollectionExistsError(error)) {
      throw error;
    }
  }

  ensuredCollections.add(collectionName);
}

async function setCollectionDocument(collectionName, docId, data) {
  await ensureCollectionExists(collectionName);

  try {
    await getDatabase().collection(collectionName).doc(docId).set({ data });
  } catch (error) {
    if (!isCollectionMissingError(error)) {
      throw error;
    }

    ensuredCollections.delete(collectionName);
    await ensureCollectionExists(collectionName);
    await getDatabase().collection(collectionName).doc(docId).set({ data });
  }
}

function getTermWeekConfigId(schoolId, semesterId) {
  return `${String(schoolId || '').trim()}_${String(semesterId || '').trim()}`;
}

function getTermWeekReportId(schoolId, semesterId, openid) {
  return `${getTermWeekConfigId(schoolId, semesterId)}_${String(openid || '').trim()}`;
}

function normalizeTermWeekInput(event = {}) {
  const school = getSchoolOrThrow(event.schoolId || DEFAULT_SCHOOL_ID);
  const semesterId = sanitizeText(event.semesterId, 80);
  const term = sanitizeText(event.term, 80);
  const weekNumber = Number(event.weekNumber);
  const rawWeekMondayDate = sanitizeText(event.weekMondayDate, 20);
  const date = parseDateText(rawWeekMondayDate);
  const weekMondayDate = date ? formatDateText(date) : rawWeekMondayDate;

  if (!semesterId) {
    throw new PublicError('缺少学期信息', 'INVALID_INPUT');
  }

  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > TERM_WEEK_MAX_WEEK) {
    throw new PublicError(`周次需为 1-${TERM_WEEK_MAX_WEEK} 周`, 'INVALID_INPUT');
  }

  if (!date) {
    throw new PublicError('请选择有效日期', 'INVALID_INPUT');
  }

  if (date.getDay() !== 1) {
    throw new PublicError('起始周日期必须是周一', 'INVALID_INPUT');
  }

  const termStartDate = formatDateText(addDays(date, (1 - weekNumber) * 7));

  return {
    schoolId: school.id,
    schoolName: school.name,
    semesterId,
    term,
    weekNumber,
    weekMondayDate,
    termStartDate
  };
}

function normalizeTermWeekLookup(event = {}, binding = null) {
  const schoolId = sanitizeText(event.schoolId, 80) || getSchoolIdFromBinding(binding);
  const school = getSchoolOrThrow(schoolId);
  const semesterId = sanitizeText(event.semesterId, 80);

  if (!semesterId) {
    throw new PublicError('缺少学期信息', 'INVALID_INPUT');
  }

  return {
    schoolId: school.id,
    schoolName: school.name,
    semesterId,
    term: sanitizeText(event.term, 80)
  };
}

async function readTermWeekConfig(schoolId, semesterId) {
  try {
    const result = await getDatabase()
      .collection(TERM_WEEK_CONFIG_COLLECTION)
      .doc(getTermWeekConfigId(schoolId, semesterId))
      .get();

    return result.data || null;
  } catch (error) {
    if (isNotFoundError(error) || isCollectionMissingError(error)) {
      return null;
    }

    throw error;
  }
}

async function removeTermWeekConfig(schoolId, semesterId) {
  try {
    await getDatabase()
      .collection(TERM_WEEK_CONFIG_COLLECTION)
      .doc(getTermWeekConfigId(schoolId, semesterId))
      .remove();
  } catch (error) {
    if (isNotFoundError(error) || isCollectionMissingError(error)) {
      return;
    }

    throw error;
  }
}

async function readTermWeekReport(schoolId, semesterId, openid) {
  try {
    const result = await getDatabase()
      .collection(TERM_WEEK_REPORT_COLLECTION)
      .doc(getTermWeekReportId(schoolId, semesterId, openid))
      .get();

    return result.data || null;
  } catch (error) {
    if (isNotFoundError(error) || isCollectionMissingError(error)) {
      return null;
    }

    throw error;
  }
}

async function getTermWeekReports(schoolId, semesterId, limit = 100) {
  try {
    const result = await getDatabase()
      .collection(TERM_WEEK_REPORT_COLLECTION)
      .where({ schoolId, semesterId })
      .orderBy('firstReportedAt', 'asc')
      .limit(limit)
      .get();

    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return [];
    }

    throw error;
  }
}

function buildTermWeekProgress(reports) {
  const latestByOpenid = new Map();

  (Array.isArray(reports) ? reports : [])
    .filter((report) => report && (report.openid || report._openid) && report.termStartDate)
    .forEach((report) => {
      const openid = report.openid || report._openid;
      const existing = latestByOpenid.get(openid);
      const firstReportedAt = existing && existing.firstReportedAt ?
        existing.firstReportedAt :
        report.firstReportedAt;
      const existingUpdatedAt = String(existing && existing.updatedAt || existing && existing.firstReportedAt || '');
      const reportUpdatedAt = String(report.updatedAt || report.firstReportedAt || '');

      if (!existing || reportUpdatedAt >= existingUpdatedAt) {
        latestByOpenid.set(openid, {
          ...report,
          openid,
          firstReportedAt
        });
      }
    });

  const votes = [...latestByOpenid.values()]
    .sort((left, right) => String(left.firstReportedAt || '').localeCompare(String(right.firstReportedAt || '')))
    .slice(0, TERM_WEEK_REPORT_TARGET);
  const countByStartDate = {};
  const voteOptions = [];
  let best = null;
  let bestCount = 0;

  votes.forEach((report, index) => {
    const key = report.termStartDate;
    const count = (countByStartDate[key] || 0) + 1;
    countByStartDate[key] = count;

    if (!best || count > bestCount) {
      best = report;
      bestCount = count;
    }
  });

  Object.keys(countByStartDate).forEach((termStartDate) => {
    const sample = votes.find((report) => report.termStartDate === termStartDate) || {};

    voteOptions.push({
      termStartDate,
      weekNumber: sample.weekNumber || 1,
      weekMondayDate: sample.weekMondayDate || termStartDate,
      count: countByStartDate[termStartDate]
    });
  });

  voteOptions.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return String(left.termStartDate).localeCompare(String(right.termStartDate));
  });

  return {
    reportCount: votes.length,
    targetCount: TERM_WEEK_REPORT_TARGET,
    remainingCount: Math.max(TERM_WEEK_REPORT_TARGET - votes.length, 0),
    ready: votes.length >= TERM_WEEK_REPORT_TARGET,
    winner: best ? {
      termStartDate: best.termStartDate,
      weekNumber: best.weekNumber,
      weekMondayDate: best.weekMondayDate,
      count: bestCount
    } : null,
    voteOptions
  };
}

function formatTermWeekConfig(config) {
  if (!config) {
    return null;
  }

  return {
    id: config._id || getTermWeekConfigId(config.schoolId, config.semesterId),
    schoolId: config.schoolId || '',
    schoolName: config.schoolName || '',
    semesterId: config.semesterId || '',
    term: config.term || '',
    weekNumber: Number(config.weekNumber) || 0,
    weekMondayDate: config.weekMondayDate || '',
    termStartDate: config.termStartDate || '',
    source: config.source || '',
    sourceText: config.source === 'admin-shell' ? '待配置' : '管理员配置',
    lockedAt: config.lockedAt || '',
    lockedText: formatDateTimeText(config.lockedAt),
    updatedBy: maskOpenId(config.updatedBy || '')
  };
}

function formatTermWeekReport(report) {
  if (!report) {
    return null;
  }

  return {
    weekNumber: Number(report.weekNumber) || 1,
    weekMondayDate: report.weekMondayDate || '',
    termStartDate: report.termStartDate || '',
    firstReportedAt: report.firstReportedAt || '',
    firstReportedText: formatDateTimeText(report.firstReportedAt),
    updatedText: formatDateTimeText(report.updatedAt)
  };
}

async function saveTermWeekConfig(input, source, updatedBy) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = getTermWeekConfigId(input.schoolId, input.semesterId);
  const data = {
    schoolId: input.schoolId,
    schoolName: input.schoolName,
    semesterId: input.semesterId,
    term: input.term || '',
    weekNumber: input.weekNumber,
    weekMondayDate: input.weekMondayDate,
    termStartDate: input.termStartDate,
    source,
    lockedAt: now,
    updatedBy: updatedBy || '',
    updatedAt: db.serverDate()
  };

  await setCollectionDocument(TERM_WEEK_CONFIG_COLLECTION, id, data);

  return data;
}

async function ensureTermWeekConfigShell(input) {
  const normalizedSchoolId = sanitizeText(input && input.schoolId, 80) || DEFAULT_SCHOOL_ID;
  const normalizedSemesterId = sanitizeText(input && input.semesterId, 80);
  const normalizedTerm = sanitizeText(input && input.term, 80) || sanitizeText(input && input.label, 120);

  if (!normalizedSemesterId) {
    return null;
  }

  const existing = await readTermWeekConfig(normalizedSchoolId, normalizedSemesterId);

  if (existing) {
    return existing;
  }

  const school = getSchoolOrThrow(normalizedSchoolId);
  const id = getTermWeekConfigId(normalizedSchoolId, normalizedSemesterId);
  const data = {
    schoolId: normalizedSchoolId,
    schoolName: school.name,
    semesterId: normalizedSemesterId,
    term: normalizedTerm,
    weekNumber: 0,
    weekMondayDate: '',
    termStartDate: '',
    source: 'admin-shell',
    lockedAt: '',
    updatedBy: '',
    updatedAt: getDatabase().serverDate()
  };

  await setCollectionDocument(TERM_WEEK_CONFIG_COLLECTION, id, data);

  return data;
}

function getPreferredTermLabel(reports, fallback = '') {
  const fromReports = (Array.isArray(reports) ? reports : [])
    .map((report) => sanitizeText(report && report.term, 80))
    .find(Boolean);

  return sanitizeText(fallback, 80) || fromReports || '';
}

function groupTermWeekReports(reports) {
  const groups = new Map();

  (Array.isArray(reports) ? reports : []).forEach((report) => {
    if (!report || !report.schoolId || !report.semesterId) {
      return;
    }

    const key = getTermWeekConfigId(report.schoolId, report.semesterId);
    const list = groups.get(key) || [];
    list.push(report);
    groups.set(key, list);
  });

  for (const [key, list] of groups.entries()) {
    list.sort((left, right) => String(left.firstReportedAt || '').localeCompare(String(right.firstReportedAt || '')));
    groups.set(key, list);
  }

  return groups;
}

function formatTermWeekAdminItem(config, reports, sourceConfig, schoolName = '') {
  const progress = buildTermWeekProgress(reports);
  const effectiveConfig = config || sourceConfig || null;
  const formattedConfig = formatTermWeekConfig(effectiveConfig);

  return {
    id: getTermWeekConfigId(
      effectiveConfig && effectiveConfig.schoolId || (reports[0] && reports[0].schoolId) || '',
      effectiveConfig && effectiveConfig.semesterId || (reports[0] && reports[0].semesterId) || ''
    ),
    schoolId: effectiveConfig && effectiveConfig.schoolId || (reports[0] && reports[0].schoolId) || '',
    schoolName: effectiveConfig && effectiveConfig.schoolName || schoolName || '',
    semesterId: effectiveConfig && effectiveConfig.semesterId || (reports[0] && reports[0].semesterId) || '',
    term: effectiveConfig && effectiveConfig.term || getPreferredTermLabel(reports, ''),
    config: formattedConfig,
    progress,
    report: reports.length > 0 ? formatTermWeekReport(reports[0]) : null,
    canSubmitReport: false,
    updatedText: formatDateTimeText(effectiveConfig && effectiveConfig.lockedAt || (reports[0] && reports[0].updatedAt))
  };
}

function formatAdminSemesterOptionLabel(label, semesterId) {
  const normalizedLabel = normalizeSemesterLabel(sanitizeText(label, 120) || sanitizeText(semesterId, 80));
  const normalizedSemesterId = sanitizeText(semesterId, 80);

  return normalizedLabel === normalizedSemesterId ? normalizedSemesterId : `${normalizedLabel} (${normalizedSemesterId})`;
}

function addAdminSemesterOption(optionMap, schoolId, schoolName, semesterId, label, term = '', options = {}) {
  const normalizedSchoolId = sanitizeText(schoolId, 80) || DEFAULT_SCHOOL_ID;
  const normalizedSemesterId = sanitizeText(semesterId, 80);
  const normalizedLabel = normalizeSemesterLabel(sanitizeText(label, 120) || sanitizeText(term, 120) || normalizedSemesterId);
  const school = getSchool(normalizedSchoolId);
  const isSelected = Boolean(options.selected);

  if (!normalizedSemesterId) {
    return;
  }

  if (!isAllowedSemesterOption(normalizedSemesterId, normalizedLabel, term)) {
    return;
  }

  const existingBySemesterId = [...optionMap.values()].find((item) => (
    item &&
    item.schoolId === normalizedSchoolId &&
    item.semesterId === normalizedSemesterId
  )) || null;
  const shouldUseLabel = Boolean(options.preferLabel) || !existingBySemesterId || !existingBySemesterId.label || existingBySemesterId.label === existingBySemesterId.semesterId;
  const nextOption = existingBySemesterId || {
    schoolId: normalizedSchoolId,
    schoolName: sanitizeText(schoolName, 80) || (school && school.name) || normalizedSchoolId,
    id: normalizedSemesterId,
    semesterId: normalizedSemesterId,
    label: formatAdminSemesterOptionLabel(normalizedLabel, normalizedSemesterId),
    term: sanitizeText(term, 80) || normalizedLabel,
    selected: isSelected
  };

  nextOption.id = normalizedSemesterId;
  nextOption.semesterId = normalizedSemesterId;
  nextOption.schoolId = normalizedSchoolId;
  nextOption.schoolName = sanitizeText(schoolName, 80) || nextOption.schoolName || (school && school.name) || normalizedSchoolId;
  nextOption.selected = Boolean(nextOption.selected || isSelected);

  if (shouldUseLabel) {
    nextOption.label = formatAdminSemesterOptionLabel(normalizedLabel, normalizedSemesterId);
  }

  if (term && (Boolean(options.preferLabel) || !nextOption.term)) {
    nextOption.term = sanitizeText(term, 80);
  }

  optionMap.set(getTermWeekConfigId(normalizedSchoolId, normalizedSemesterId), nextOption);
}

function collectScheduleSemesterOptions(optionMap, binding, schedule) {
  const schoolId = getSchoolIdFromBinding(binding);
  const schoolName = binding && binding.schoolName || getSchoolOrThrow(schoolId).name;

  if (!schedule || typeof schedule !== 'object') {
    return;
  }

  (Array.isArray(schedule.semesters) ? schedule.semesters : []).forEach((semester) => {
    addAdminSemesterOption(
      optionMap,
      schoolId,
      schoolName,
      semester && semester.id,
      semester && (semester.label || semester.title),
      semester && (semester.term || semester.label || semester.title),
      { selected: semester && semester.selected, preferLabel: true }
    );
  });

  addAdminSemesterOption(
    optionMap,
    schoolId,
    schoolName,
    schedule.selectedSemesterId,
    schedule.term,
    schedule.term,
    { selected: true }
  );
}

function buildAdminSemesterOptionMap(bindings, configs, reports) {
  const optionMap = new Map();

  (Array.isArray(bindings) ? bindings : []).forEach((binding) => {
    collectScheduleSemesterOptions(optionMap, binding, binding && binding.lastSchedule);

    Object.values(normalizeScheduleCaches(binding && binding.scheduleCaches)).forEach((entry) => {
      collectScheduleSemesterOptions(optionMap, binding, entry && entry.schedule);
    });
  });

  (Array.isArray(configs) ? configs : []).forEach((config) => {
    addAdminSemesterOption(optionMap, config.schoolId, config.schoolName, config.semesterId, config.term, config.term);
  });

  (Array.isArray(reports) ? reports : []).forEach((report) => {
    addAdminSemesterOption(optionMap, report.schoolId, report.schoolName, report.semesterId, report.term, report.term);
  });

  return optionMap;
}

function getConfigFromMap(configMap, schoolId, semesterId) {
  return configMap.get(getTermWeekConfigId(schoolId, semesterId)) || null;
}

function buildTermWeekSchoolGroups(schools, semesterOptions, configMap) {
  return (Array.isArray(schools) ? schools : []).map((school) => {
    const schoolSemesters = new Map();

    (Array.isArray(semesterOptions) ? semesterOptions : [])
      .filter((semester) => semester.schoolId === school.id)
      .forEach((semester) => {
        const config = getConfigFromMap(configMap, school.id, semester.semesterId);
        const key = getTermWeekConfigId(school.id, semester.semesterId);
        const existing = schoolSemesters.get(key);
        const nextSemester = {
          schoolId: school.id,
          schoolName: school.name,
          semesterId: semester.semesterId,
          term: semester.term || semester.label || semester.semesterId,
          label: semester.label || semester.term || semester.semesterId,
          weekMondayDate: config && config.weekMondayDate || '',
          termStartDate: config && config.termStartDate || '',
          weekNumber: config && Number(config.weekNumber) || 1,
          config: formatTermWeekConfig(config),
          updatedText: config ? formatDateTimeText(config.lockedAt || config.updatedAt) : ''
        };

        if (!existing || (config && !existing.config)) {
          schoolSemesters.set(key, nextSemester);
          return;
        }

        if (semester.selected) {
          existing.semesterId = semester.semesterId;
        }

        if (config) {
          existing.weekMondayDate = nextSemester.weekMondayDate;
          existing.termStartDate = nextSemester.termStartDate;
          existing.weekNumber = nextSemester.weekNumber;
          existing.config = nextSemester.config;
          existing.updatedText = nextSemester.updatedText;
        }

        if (!existing.label || existing.label === existing.semesterId) {
          existing.label = nextSemester.label;
        }

        if (!existing.term) {
          existing.term = nextSemester.term;
        }
      });

    const semesters = [...schoolSemesters.values()];

    return {
      schoolId: school.id,
      schoolName: school.name,
      semesters
    };
  }).filter((group) => group.semesters.length > 0);
}

function sortAdminSemesterOptions(optionMap) {
  return [...optionMap.values()].sort((left, right) => {
    if (left.schoolName !== right.schoolName) {
      return String(left.schoolName || '').localeCompare(String(right.schoolName || ''));
    }

    return String(right.semesterId || '').localeCompare(String(left.semesterId || ''));
  });
}

function dedupeAdminSemesterOptions(options, configMap = new Map()) {
  const deduped = new Map();

  (Array.isArray(options) ? options : []).forEach((option) => {
    const idKey = getTermWeekConfigId(option.schoolId, option.semesterId);
    const existing = deduped.get(idKey);
    const config = getConfigFromMap(configMap, option.schoolId, option.semesterId);
    const nextOption = {
      ...option,
      label: option.label && option.label.includes('(')
        ? option.label
        : normalizeSemesterLabel(option.label || option.term || option.semesterId)
    };

    if (
      !existing ||
      (nextOption.selected && !existing.selected) ||
      (config && !getConfigFromMap(configMap, existing.schoolId, existing.semesterId))
    ) {
      deduped.set(idKey, nextOption);
      return;
    }

    if (!existing.term && nextOption.term) {
      existing.term = nextOption.term;
    }

    if (!existing.label || existing.label === existing.semesterId) {
      existing.label = nextOption.label;
    }
  });

  return deduped;
}

async function collectRemoteSemesterOptions(optionMap, bindings) {
  const candidates = new Map();

  (Array.isArray(bindings) ? bindings : []).forEach((binding) => {
    if (!isBoundBinding(binding)) {
      return;
    }

    const schoolId = getSchoolIdFromBinding(binding);

    if (!candidates.has(schoolId)) {
      candidates.set(schoolId, []);
    }

    candidates.get(schoolId).push(binding);
  });

  for (const [schoolId, schoolBindings] of candidates.entries()) {
    const adapter = getAdapterOrThrow(schoolId);

    if (typeof adapter.fetchSemestersByCredentials !== 'function') {
      continue;
    }

    for (const binding of schoolBindings.slice(0, 3)) {
      try {
        const semesters = await adapter.fetchSemestersByCredentials(
          binding.studentId,
          decryptPassword(binding.passwordCipher)
        );

        semesters.forEach((semester) => {
          addAdminSemesterOption(
            optionMap,
            schoolId,
            binding.schoolName,
            semester && semester.id,
            semester && (semester.label || semester.title),
            semester && (semester.term || semester.label || semester.title),
            { selected: semester && semester.selected }
          );
        });

        if (semesters.length > 0) {
          break;
        }
      } catch (error) {
        console.warn(`fetch semesters failed for ${schoolId}:`, getErrorMessage(error, ''));
      }
    }
  }
}

async function buildAdminSemesterOptions(bindings, configs, reports) {
  const optionMap = buildAdminSemesterOptionMap(bindings, configs, reports);
  const configMap = new Map();

  (Array.isArray(configs) ? configs : []).forEach((config) => {
    configMap.set(getTermWeekConfigId(config.schoolId, config.semesterId), config);
  });

  await collectRemoteSemesterOptions(optionMap, bindings);

  return sortAdminSemesterOptions(dedupeAdminSemesterOptions([...optionMap.values()], configMap));
}

async function getTermWeekConfig(event = {}) {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!isBoundBinding(binding)) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const lookup = normalizeTermWeekLookup(event, binding);
  const config = await readTermWeekConfig(lookup.schoolId, lookup.semesterId);
  const reports = await getTermWeekReports(lookup.schoolId, lookup.semesterId);
  const progress = buildTermWeekProgress(reports);

  return {
    success: true,
    data: {
      school: {
        id: lookup.schoolId,
        name: lookup.schoolName
      },
      semesterId: lookup.semesterId,
      term: lookup.term || getPreferredTermLabel(reports, ''),
      config: formatTermWeekConfig(config),
      report: null,
      progress,
      canSubmitReport: false,
      loadedAt: new Date().toISOString()
    }
  };
}

async function submitTermWeekReport(event = {}) {
  throw new PublicError('学期起始周仅支持管理员在后台配置', 'USER_REPORT_DISABLED');
}

async function adminSaveTermWeekConfig(event = {}) {
  const updatedBy = assertAdmin();
  const input = normalizeTermWeekInput({
    ...event,
    schoolId: event.schoolId,
    semesterId: event.semesterId,
    term: event.term
  });
  const config = await saveTermWeekConfig(input, 'admin', updatedBy);

  return {
    success: true,
    data: {
      config: formatTermWeekConfig(config),
      progress: buildTermWeekProgress(await getTermWeekReports(input.schoolId, input.semesterId)),
      loadedAt: new Date().toISOString()
    }
  };
}

async function adminListTermWeekConfigs(event = {}) {
  assertAdmin();

  const schoolId = sanitizeText(event.schoolId, 80);
  const semesterId = sanitizeText(event.semesterId, 80);
  const configs = await getLatestDocuments(TERM_WEEK_CONFIG_COLLECTION, {
    _id: true,
    schoolId: true,
    schoolName: true,
    semesterId: true,
    term: true,
    weekNumber: true,
    weekMondayDate: true,
    termStartDate: true,
    source: true,
    lockedAt: true,
    updatedBy: true,
    updatedAt: true
  }, 'lockedAt', 100);
  const reports = await getLatestDocuments(TERM_WEEK_REPORT_COLLECTION, {
    _id: true,
    _openid: true,
    schoolId: true,
    schoolName: true,
    semesterId: true,
    term: true,
    weekNumber: true,
    weekMondayDate: true,
    termStartDate: true,
    firstReportedAt: true,
    updatedAt: true
  }, 'firstReportedAt', 500);
  const bindings = await getLatestDocuments(BINDING_COLLECTION, {
    _id: true,
    _openid: true,
    studentId: true,
    passwordCipher: true,
    schoolId: true,
    schoolName: true,
    lastSchedule: true,
    scheduleCaches: true,
    lastFetchedAt: true
  }, 'lastFetchedAt', 200);
  const reportGroups = groupTermWeekReports(reports);
  const semesterOptions = await buildAdminSemesterOptions(bindings, configs, reports);
  const ensuredConfigs = [...configs];

  for (const semester of semesterOptions) {
    if (!semester || !semester.schoolId || !semester.semesterId) {
      continue;
    }

    const exists = ensuredConfigs.find((config) => (
      config &&
      config.schoolId === semester.schoolId &&
      config.semesterId === semester.semesterId
    ));

    if (exists) {
      continue;
    }

    const shell = await ensureTermWeekConfigShell({
      schoolId: semester.schoolId,
      semesterId: semester.semesterId,
      term: semester.term || semester.label,
      label: semester.label
    });

    if (shell) {
      ensuredConfigs.push(shell);
    }
  }

  const configMap = new Map();
  ensuredConfigs.forEach((config) => {
    const key = getTermWeekConfigId(config.schoolId, config.semesterId);
    configMap.set(key, config);
  });

  const schools = listSchools();
  const schoolGroups = buildTermWeekSchoolGroups(schools, semesterOptions, configMap);
  const groupedKeys = new Set([...configMap.keys(), ...reportGroups.keys()]);
  const items = [...groupedKeys]
    .filter((key) => {
      const config = configMap.get(key);
      const reportsForGroup = reportGroups.get(key) || [];
      const firstReport = reportsForGroup[0] || null;
      const groupSchoolId = config && config.schoolId || firstReport && firstReport.schoolId || '';
      const groupSemesterId = config && config.semesterId || firstReport && firstReport.semesterId || '';

      if (schoolId && groupSchoolId !== schoolId) {
        return false;
      }

      if (semesterId && groupSemesterId !== semesterId) {
        return false;
      }

      return true;
    })
    .map((key) => {
      const config = configMap.get(key) || null;
      const reportsForGroup = reportGroups.get(key) || [];
      const fallbackSchoolName = (reportsForGroup[0] && reportsForGroup[0].schoolName) || '';
      const item = formatTermWeekAdminItem(config, reportsForGroup, null, fallbackSchoolName);

      return item;
    })
    .sort((left, right) => {
      if (left.schoolName !== right.schoolName) {
        return String(left.schoolName || '').localeCompare(String(right.schoolName || ''));
      }

      return String(left.semesterId || '').localeCompare(String(right.semesterId || ''));
    });

  return {
    success: true,
    data: {
      schools,
      semesterOptions,
      schoolGroups,
      items,
      summary: {
        configCount: configs.length,
        reportCount: reports.length,
        readyCount: items.filter((item) => item.progress && item.progress.ready).length
      },
      loadedAt: new Date().toISOString()
    }
  };
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

function getCacheTimestamp(value) {
  const time = new Date(value || '').getTime();

  return Number.isFinite(time) ? time : 0;
}

function getLatestTimestampValue(values = []) {
  let latestValue = '';
  let latestTime = 0;

  (Array.isArray(values) ? values : []).forEach((value) => {
    const timestamp = getCacheTimestamp(value);

    if (timestamp > latestTime) {
      latestTime = timestamp;
      latestValue = value;
    }
  });

  return latestValue || '';
}

function isCacheFresh(value, now = Date.now()) {
  const timestamp = getCacheTimestamp(value);

  return timestamp > 0 && now - timestamp < CACHE_TTL_MS;
}

function hasScheduleCache(schedule, exams) {
  return schedule &&
    (
      Array.isArray(schedule.courses) ||
      Array.isArray(schedule.semesterCourses)
    ) &&
    Array.isArray(exams);
}

function hasCurrentCacheSchema(value) {
  return value && Number(value.cacheVersion) === CACHE_SCHEMA_VERSION;
}

function hasGradesCache(grades) {
  return grades &&
    Array.isArray(grades.summary) &&
    Array.isArray(grades.semesters);
}

function withCacheVersion(data) {
  return {
    ...(data || {}),
    cacheVersion: CACHE_SCHEMA_VERSION
  };
}

function hasScheduleCaches(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function getBindingLatestScheduleFetchedAt(binding, fetchedAt = '') {
  const values = [fetchedAt, binding && binding.lastFetchedAt];

  Object.values(normalizeScheduleCaches(binding && binding.scheduleCaches)).forEach((entry) => {
    values.push(entry && entry.fetchedAt);
  });

  return getLatestTimestampValue(values);
}

function getBindingEffectiveFetchedAt(binding, fetchedAt = '') {
  return getLatestTimestampValue([
    getBindingLatestScheduleFetchedAt(binding, fetchedAt),
    binding && binding.updatedAt,
    binding && binding._updateTime
  ]);
}

function isBoundBinding(binding) {
  return Boolean(binding && binding.studentId && binding.passwordCipher);
}

function isCachedBinding(binding) {
  return Boolean(binding && binding.studentId);
}

function isUnifiedCacheReady(binding) {
  return Boolean(
    binding &&
    hasScheduleCache(binding.lastSchedule, binding.lastExams) &&
    hasGradesCache(binding.lastGrades) &&
    hasScheduleCaches(binding.scheduleCaches) &&
    hasCurrentCacheSchema(binding) &&
    isCacheFresh(binding.lastFetchedAt)
  );
}

function getScheduleCacheKey(semesterId) {
  const value = String(semesterId || '').trim();

  return value || 'current';
}

function getSemesterIndexFromText(value) {
  const text = String(value || '').replace(/\s+/g, '');

  if (/(?:第?2学期|学期2|第二学期|下学期|春学期)/.test(text)) {
    return 2;
  }

  if (/(?:第?1学期|学期1|第一学期|上学期|秋学期)/.test(text)) {
    return 1;
  }

  return 0;
}

function getDateInChina(date = new Date()) {
  const text = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

  return parseDateText(text) || new Date(date);
}

function getCurrentSemesterTermIndexByDate(date = new Date()) {
  const month = getDateInChina(date).getMonth() + 1;

  return month >= 9 || month <= 1 ? 1 : 2;
}

function getCurrentSemesterStartYearByDate(date = new Date()) {
  const currentDate = getDateInChina(date);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  return month >= 9 ? year : year - 1;
}

function getScheduleSemesterId(schedule, fallbackSemesterId) {
  return getScheduleCacheKey(fallbackSemesterId || schedule && schedule.selectedSemesterId);
}

function normalizeScheduleCaches(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function getCacheSemesterCandidates(binding) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (semester, extra = {}) => {
    if (!semester) {
      return;
    }

    const semesterId = sanitizeText(semester.id || semester.semesterId, 80);
    const label = sanitizeText(semester.label || semester.title || semester.term, 120);

    if (!semesterId && !label) {
      return;
    }

    const key = `${semesterId}::${label}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push({
      semesterId,
      label,
      selected: Boolean(semester.selected || extra.selected),
      source: extra.source || ''
    });
  };

  const lastSchedule = binding && binding.lastSchedule || {};

  (Array.isArray(lastSchedule.semesters) ? lastSchedule.semesters : []).forEach((semester) => {
    pushCandidate(semester, { source: 'lastSchedule' });
  });

  pushCandidate({
    id: lastSchedule.selectedSemesterId,
    label: lastSchedule.term,
    selected: true
  }, { source: 'lastScheduleSelected', selected: true });

  Object.values(normalizeScheduleCaches(binding && binding.scheduleCaches)).forEach((entry) => {
    const schedule = entry && entry.schedule || {};

    (Array.isArray(schedule.semesters) ? schedule.semesters : []).forEach((semester) => {
      pushCandidate(semester, { source: 'scheduleCache' });
    });

    pushCandidate({
      id: schedule.selectedSemesterId,
      label: schedule.term,
      selected: true
    }, { source: 'scheduleCacheSelected', selected: true });
  });

  return candidates;
}

async function resolveCurrentSemesterId(binding) {
  const schoolId = getSchoolIdFromBinding(binding);
  const candidates = getCacheSemesterCandidates(binding);
  const configs = await getLatestDocuments(TERM_WEEK_CONFIG_COLLECTION, {
    schoolId: true,
    semesterId: true,
    term: true,
    termStartDate: true
  }, 'lockedAt', 200);
  const today = getDateInChina();
  const matchedConfig = configs
    .filter((config) => config && config.schoolId === schoolId && config.termStartDate)
    .map((config) => ({
      ...config,
      parsedDate: parseDateText(config.termStartDate)
    }))
    .filter((config) => config.parsedDate && config.parsedDate.getTime() <= today.getTime())
    .sort((left, right) => right.parsedDate.getTime() - left.parsedDate.getTime())[0] || null;

  if (matchedConfig && matchedConfig.semesterId) {
    return matchedConfig.semesterId;
  }

  const targetStartYear = getCurrentSemesterStartYearByDate(today);
  const targetTermIndex = getCurrentSemesterTermIndexByDate(today);
  const inferredCandidate = candidates.find((candidate) => {
    const startYear = getSemesterStartYear([candidate.label, candidate.semesterId].filter(Boolean).join(' '));
    const termIndex = getSemesterIndexFromText([candidate.label, candidate.semesterId].filter(Boolean).join(' '));

    return startYear === targetStartYear && termIndex === targetTermIndex;
  });

  if (inferredCandidate && inferredCandidate.semesterId) {
    return inferredCandidate.semesterId;
  }

  return sanitizeText(binding && binding.lastSchedule && binding.lastSchedule.selectedSemesterId, 80);
}

function createScheduleCacheEntry(schedule, exams, fetchedAt) {
  return {
    schedule,
    exams,
    cacheVersion: CACHE_SCHEMA_VERSION,
    fetchedAt
  };
}

function splitSemesterCourseGroups(schedule) {
  const source = schedule || {};
  const semesters = Array.isArray(source.semesters) ? source.semesters : [];
  const groups = Array.isArray(source.semesterCourses)
    ? source.semesterCourses
    : (
      Array.isArray(source.courses) &&
      source.courses.every((item) => item && typeof item === 'object' && Array.isArray(item.courses))
        ? source.courses
        : []
    );

  if (groups.length > 0) {
    return groups.map((group, index) => {
      const semester = semesters[index] || {};

      return {
        semesterId: sanitizeText(group && group.semesterId, 80) || sanitizeText(semester && semester.id, 80),
        term: sanitizeText(group && group.term, 120) || sanitizeText(semester && (semester.label || semester.title), 120),
        label: sanitizeText(group && group.label, 120) || sanitizeText(semester && (semester.label || semester.title), 120),
        courses: Array.isArray(group && group.courses) ? group.courses : []
      };
    }).filter((group) => group.semesterId);
  }

  const semesterId = sanitizeText(source.selectedSemesterId, 80);

  if (!semesterId) {
    return [];
  }

  return [{
    semesterId,
    term: sanitizeText(source.term, 120),
    label: sanitizeText(source.term, 120),
    courses: Array.isArray(source.courses) ? source.courses : []
  }];
}

function getCoursesForSemester(schedule, semesterId = '') {
  const source = schedule || {};
  const groups = splitSemesterCourseGroups(schedule);
  const normalizedSemesterId = sanitizeText(semesterId || schedule && schedule.selectedSemesterId, 80);

  if (!normalizedSemesterId) {
    return Array.isArray(source.courses) && source.courses.every((item) => !Array.isArray(item && item.courses))
      ? source.courses
      : [];
  }

  const matched = groups.find((group) => group.semesterId === normalizedSemesterId);

  if (matched) {
    return matched.courses;
  }

  const semesters = Array.isArray(schedule && schedule.semesters) ? schedule.semesters : [];
  const semesterIndex = semesters.findIndex((semester) => sanitizeText(semester && semester.id, 80) === normalizedSemesterId);

  if (semesterIndex >= 0 && groups[semesterIndex] && Array.isArray(groups[semesterIndex].courses)) {
    return groups[semesterIndex].courses;
  }

  return Array.isArray(source.courses) && source.courses.every((item) => !Array.isArray(item && item.courses))
    ? source.courses
    : [];
}

function withSelectedSemesterCourses(schedule, semesterId = '') {
  const source = schedule || {};
  const selectedSemesterId = sanitizeText(semesterId || source.selectedSemesterId, 80);

  return {
    ...source,
    selectedSemesterId,
    courses: getCoursesForSemester(source, selectedSemesterId)
  };
}

function normalizeScheduleForStorage(schedule) {
  const source = schedule || {};
  const semesterCourses = splitSemesterCourseGroups(source);

  return {
    ...source,
    courses: semesterCourses,
    semesterCourses
  };
}

function buildScheduleEntryFromLastSchedule(binding, semesterId) {
  const lastSchedule = binding && binding.lastSchedule;
  const normalizedSemesterId = sanitizeText(semesterId, 80);

  if (!lastSchedule || !normalizedSemesterId) {
    return null;
  }

  const courses = getCoursesForSemester(lastSchedule, normalizedSemesterId);

  if (!Array.isArray(courses) || courses.length === 0) {
    return null;
  }

  return createScheduleCacheEntry({
    ...withSelectedSemesterCourses(lastSchedule, normalizedSemesterId),
    selectedSemesterId: normalizedSemesterId
  }, binding && binding.lastExams || [], binding && binding.lastFetchedAt || '');
}

function mergeScheduleCaches(existingCaches, schedule, exams, fetchedAt, semesterId) {
  const caches = normalizeScheduleCaches(existingCaches);
  const entry = createScheduleCacheEntry(schedule, exams, fetchedAt);
  const key = getScheduleSemesterId(schedule, semesterId);

  caches[key] = entry;

  if (!semesterId) {
    caches.current = entry;
  }

  return caches;
}

function getCachedSemesterSchedule(binding, semesterId) {
  const lastScheduleEntry = buildScheduleEntryFromLastSchedule(binding, semesterId);
  const caches = normalizeScheduleCaches(binding && binding.scheduleCaches);
  const entry = caches[getScheduleCacheKey(semesterId)];
  const validEntry = entry && hasScheduleCache(entry.schedule, entry.exams) && hasCurrentCacheSchema(entry)
    ? entry
    : null;

  if (lastScheduleEntry && validEntry) {
    return getCacheTimestamp(validEntry.fetchedAt) >= getCacheTimestamp(lastScheduleEntry.fetchedAt)
      ? validEntry
      : lastScheduleEntry;
  }

  return validEntry || lastScheduleEntry;
}

function getSchoolOrThrow(schoolId) {
  const school = getSchool(schoolId || DEFAULT_SCHOOL_ID);

  if (!school) {
    throw new PublicError('暂不支持所选学校', 'SCHOOL_NOT_SUPPORTED');
  }

  return school;
}

function getSchoolIdFromBinding(binding) {
  return String(binding && binding.schoolId || DEFAULT_SCHOOL_ID).trim() || DEFAULT_SCHOOL_ID;
}

function getSchoolMeta(schoolId) {
  return toPublicSchool(getSchoolOrThrow(schoolId));
}

function getSchoolMetaFromBinding(binding) {
  return getSchoolMeta(getSchoolIdFromBinding(binding));
}

function getAdapterOrThrow(schoolId) {
  const school = getSchoolOrThrow(schoolId);
  const adapter = school.adapter || school;

  if (!adapter || typeof adapter.fetchAllByCredentials !== 'function') {
    throw new PublicError('所选学校暂未配置查询函数', 'SCHOOL_ADAPTER_INVALID');
  }

  return adapter;
}

function getRequestedSchool(event = {}) {
  return getSchoolOrThrow(event.schoolId || DEFAULT_SCHOOL_ID);
}

function createDefaultProfileForBinding(binding, studentId) {
  const adapter = getAdapterOrThrow(getSchoolIdFromBinding(binding));

  return adapter.createDefaultProfile(studentId || binding && binding.studentId || '');
}

async function fetchScheduleByCredentials(studentId, password, options = {}) {
  const adapter = getAdapterOrThrow(options.schoolId);

  return adapter.fetchScheduleByCredentials(studentId, password, options);
}

async function fetchGradesByCredentials(studentId, password, options = {}) {
  const adapter = getAdapterOrThrow(options.schoolId);

  return adapter.fetchGradesByCredentials(studentId, password, options);
}

async function fetchAllByCredentials(studentId, password, options = {}) {
  const adapter = getAdapterOrThrow(options.schoolId);

  return adapter.fetchAllByCredentials(studentId, password, options);
}

async function saveBinding(openid, school, studentId, password, schedule, profile, exams = [], grades = null) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = await readBinding(openid);
  const schoolMeta = toPublicSchool(school);
  const sameAccount = Boolean(
    existing &&
    getSchoolIdFromBinding(existing) === schoolMeta.id &&
    String(existing.studentId || '').trim() === studentId
  );
  const storageSchedule = normalizeScheduleForStorage(schedule);
  const scheduleCaches = mergeScheduleCaches(
    sameAccount && existing && existing.scheduleCaches,
    storageSchedule,
    exams,
    now
  );

  await db.collection(BINDING_COLLECTION).doc(openid).set({
    data: {
      _openid: openid,
      schoolId: schoolMeta.id,
      schoolName: schoolMeta.name,
      studentId,
      passwordCipher: encryptPassword(password),
      profile,
      lastSchedule: storageSchedule,
      lastExams: exams,
      lastGrades: grades ? withCacheVersion(grades) : sameAccount && existing && existing.lastGrades || null,
      lastFetchedAt: now,
      cacheVersion: CACHE_SCHEMA_VERSION,
      scheduleCaches,
      createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
      updatedAt: db.serverDate()
    }
  });
}

async function updateScheduleCache(openid, schedule, exams = [], options = {}) {
  const db = getDatabase();
  const _ = db.command;
  const binding = options.binding || await readBinding(openid);
  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const semesterId = String(options.semesterId || '').trim();
  const school = getSchoolMetaFromBinding(binding);
  const storageSchedule = normalizeScheduleForStorage(schedule);
  const scheduleCaches = mergeScheduleCaches(
    binding && binding.scheduleCaches,
    storageSchedule,
    exams,
    fetchedAt,
    semesterId
  );
  const data = {
    schoolId: school.id,
    schoolName: school.name,
    cacheVersion: CACHE_SCHEMA_VERSION,
    scheduleCaches: _.set(scheduleCaches),
    updatedAt: db.serverDate()
  };

  if (!semesterId) {
    data.lastSchedule = _.set(storageSchedule);
    data.lastExams = _.set(exams);
    data.lastFetchedAt = fetchedAt;
  }

  await db.collection(BINDING_COLLECTION).doc(openid).update({ data });
}

async function updateGradesCache(openid, grades) {
  const db = getDatabase();
  const _ = db.command;

  await db.collection(BINDING_COLLECTION).doc(openid).update({
    data: {
      lastGrades: _.set(withCacheVersion(grades)),
      cacheVersion: CACHE_SCHEMA_VERSION,
      updatedAt: db.serverDate()
    }
  });
}

async function updateUnifiedCache(openid, binding, snapshot) {
  const db = getDatabase();
  const _ = db.command;
  const fetchedAt = snapshot.fetchedAt || new Date().toISOString();
  const school = getSchoolMetaFromBinding(binding);
  const storageSchedule = normalizeScheduleForStorage(snapshot.schedule);
  const scheduleCaches = mergeScheduleCaches(
    binding && binding.scheduleCaches,
    storageSchedule,
    snapshot.exams,
    fetchedAt
  );
  const data = {
    schoolId: school.id,
    schoolName: school.name,
    lastSchedule: _.set(storageSchedule),
    lastExams: _.set(snapshot.exams),
    lastGrades: _.set(withCacheVersion(snapshot.grades)),
    lastFetchedAt: fetchedAt,
    cacheVersion: CACHE_SCHEMA_VERSION,
    scheduleCaches: _.set(scheduleCaches),
    updatedAt: db.serverDate()
  };

  if (snapshot.profile) {
    data.profile = _.set(snapshot.profile);
  }

  await db.collection(BINDING_COLLECTION).doc(openid).update({ data });
}

async function refreshUnifiedCache(openid, binding, options = {}) {
  const fetched = await fetchAllByCredentials(
    binding.studentId,
    decryptPassword(binding.passwordCipher),
    {
      includeProfile: Boolean(options.includeProfile),
      semesterId: options.semesterId,
      schoolId: getSchoolIdFromBinding(binding)
    }
  );
  const fetchedAt = new Date().toISOString();
  const profile = options.includeProfile ? fetched.profile : binding.profile;

  await updateUnifiedCache(openid, binding, {
    schedule: fetched.schedule,
    exams: fetched.exams,
    grades: withCacheVersion(fetched.grades),
    profile,
    fetchedAt
  });

  return {
    schedule: fetched.schedule,
    exams: fetched.exams,
    grades: fetched.grades,
    profile,
    fetchedAt
  };
}

async function refreshSemesterScheduleCache(openid, binding, semesterId) {
  const fetched = await fetchScheduleByCredentials(
    binding.studentId,
    decryptPassword(binding.passwordCipher),
    {
      semesterId,
      includeExams: true,
      schoolId: getSchoolIdFromBinding(binding)
    }
  );
  const fetchedAt = new Date().toISOString();

  await updateScheduleCache(openid, fetched.schedule, fetched.exams, {
    binding,
    fetchedAt,
    semesterId
  });

  return {
    schedule: fetched.schedule,
    exams: fetched.exams,
    fetchedAt
  };
}

async function refreshBoundSchedule(openid, binding, semesterId = '') {
  if (semesterId) {
    const refreshed = await refreshSemesterScheduleCache(openid, binding, semesterId);

    return {
      ...refreshed,
      selectedSemesterId: semesterId
    };
  }

  const fetched = await fetchScheduleByCredentials(
    binding.studentId,
    decryptPassword(binding.passwordCipher),
    {
      includeExams: true,
      schoolId: getSchoolIdFromBinding(binding)
    }
  );
  const fetchedAt = new Date().toISOString();

  await updateScheduleCache(openid, fetched.schedule, fetched.exams, {
    binding,
    fetchedAt
  });

  return {
    schedule: fetched.schedule,
    exams: fetched.exams,
    fetchedAt,
    selectedSemesterId: sanitizeText(fetched.schedule && fetched.schedule.selectedSemesterId, 80)
  };
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

  if (!isCachedBinding(binding)) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const savedProfile = {
    ...(binding.profile || createDefaultProfileForBinding(binding)),
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

function withScheduleMeta(schedule, binding, exams = [], fetchedAt) {
  const selectedSchedule = withSelectedSemesterCourses(schedule, schedule && schedule.selectedSemesterId);
  const termWeekConfig = selectedSchedule && selectedSchedule.termWeekConfig || null;
  const termStartDate = selectedSchedule && selectedSchedule.termStartDate || termWeekConfig && termWeekConfig.termStartDate || '';
  const effectiveFetchedAt = getBindingEffectiveFetchedAt(binding, fetchedAt);

  return {
    ...selectedSchedule,
    exams,
    cacheVersion: CACHE_SCHEMA_VERSION,
    studentId: maskStudentId(binding.studentId),
    school: getSchoolMetaFromBinding(binding),
    lastFetchedAt: effectiveFetchedAt || new Date().toISOString(),
    termWeek: schedule && schedule.termWeek || null,
    termWeekConfig,
    termStartDate
  };
}

async function bindAccount(event) {
  const openid = getOpenId();
  const school = getRequestedSchool(event);
  const studentId = String(event.studentId || '').trim();
  const password = String(event.password || '');

  if (!studentId || !password) {
    throw new PublicError('请填写学号和密码', 'INVALID_INPUT');
  }

  const { schedule, profile, exams, grades } = await fetchAllByCredentials(studentId, password, {
    includeProfile: true,
    schoolId: school.id
  });
  await saveBinding(openid, school, studentId, password, schedule, profile, exams, grades);

  return {
    success: true,
    data: {
      ...withScheduleMeta(schedule, { studentId, schoolId: school.id }, exams),
      profile,
      grades: withCacheVersion(grades),
      isAdmin: isAdminOpenId(openid)
    }
  };
}

async function getBoundSchedule(event = {}) {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!isCachedBinding(binding)) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const requestedSemesterId = String(event.semesterId || '').trim();

  if (requestedSemesterId) {
    const cached = getCachedSemesterSchedule(binding, requestedSemesterId);

    if (!cached) {
      throw new PublicError('该学期尚未缓存，请先更新数据库', 'SEMESTER_NOT_CACHED');
    }

    return {
      success: true,
      data: withScheduleMeta({
        ...withSelectedSemesterCourses(cached.schedule, requestedSemesterId),
        selectedSemesterId: requestedSemesterId
      }, binding, cached.exams, cached.fetchedAt)
    };
  }

  const resolvedSemesterId = await resolveCurrentSemesterId(binding);

  if (resolvedSemesterId) {
    const cached = getCachedSemesterSchedule(binding, resolvedSemesterId);

    if (cached) {
      return {
        success: true,
        data: withScheduleMeta({
          ...withSelectedSemesterCourses(cached.schedule, resolvedSemesterId),
          selectedSemesterId: resolvedSemesterId
        }, binding, cached.exams, cached.fetchedAt)
      };
    }
  }

  if (hasScheduleCache(binding.lastSchedule, binding.lastExams)) {
    return {
      success: true,
      data: withScheduleMeta(binding.lastSchedule, binding, binding.lastExams, binding.lastFetchedAt)
    };
  }

  if (resolvedSemesterId) {
    const cached = getCachedSemesterSchedule(binding, resolvedSemesterId);
    if (cached) {
      return {
        success: true,
        data: withScheduleMeta({
          ...withSelectedSemesterCourses(cached.schedule, resolvedSemesterId),
          selectedSemesterId: resolvedSemesterId
        }, binding, cached.exams, cached.fetchedAt)
      };
    }
  }

  throw new PublicError('当前暂无已缓存课表，请先更新数据库', 'NO_CACHED_SCHEDULE');
}

async function getBindingStatus() {
  const openid = getOpenId();
  const binding = await readBinding(openid);
  const bound = isCachedBinding(binding);
  const canRefresh = isBoundBinding(binding);

  return {
    success: true,
    data: {
      bound,
      canRefresh,
      isAdmin: isAdminOpenId(openid),
      studentId: binding ? maskStudentId(binding.studentId) : '',
      school: bound ? getSchoolMetaFromBinding(binding) : null,
      profile: binding && binding.profile ? binding.profile : null
    }
  };
}

async function getBoundProfile() {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!isCachedBinding(binding)) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  return {
    success: true,
    data: {
      profile: binding.profile || createDefaultProfileForBinding(binding),
      studentId: maskStudentId(binding.studentId),
      school: getSchoolMetaFromBinding(binding),
      lastFetchedAt: getBindingEffectiveFetchedAt(binding),
      isAdmin: isAdminOpenId(openid)
    }
  };
}

async function getBoundGrades(event = {}) {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!isCachedBinding(binding)) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  if (hasGradesCache(binding.lastGrades)) {
    return {
      success: true,
      data: withCacheVersion(binding.lastGrades)
    };
  }

  throw new PublicError('当前暂无已缓存成绩，请先更新数据库', 'NO_CACHED_GRADES');
}

async function saveBoundProfile(event) {
  const openid = getOpenId();
  const profile = await saveProfile(openid, event.profile || {});

  return {
    success: true,
    data: {
      profile,
      studentId: maskStudentId(profile.studentId),
      school: getSchoolMetaFromBinding(await readBinding(openid)),
      isAdmin: isAdminOpenId(openid)
    }
  };
}

async function refreshAllCaches() {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!isBoundBinding(binding)) {
    throw new PublicError('请先绑定教务系统账号', 'NO_BINDING');
  }

  const refreshed = await refreshUnifiedCache(openid, binding);
  const schedule = withScheduleMeta(refreshed.schedule, binding, refreshed.exams, refreshed.fetchedAt);

  return {
    success: true,
    data: {
      schedule,
      grades: withCacheVersion(refreshed.grades),
      school: getSchoolMetaFromBinding(binding),
      refreshedAt: refreshed.fetchedAt
    }
  };
}

async function refreshScheduleCache(event = {}) {
  const openid = getOpenId();
  const binding = await readBinding(openid);

  if (!isBoundBinding(binding)) {
    throw new PublicError('璇峰厛缁戝畾鏁欏姟绯荤粺璐﹀彿', 'NO_BINDING');
  }

  const requestedSemesterId = sanitizeText(event.semesterId, 80);
  const refreshed = await refreshBoundSchedule(openid, binding, requestedSemesterId);

  return {
    success: true,
    data: withScheduleMeta({
      ...refreshed.schedule,
      selectedSemesterId: refreshed.selectedSemesterId || requestedSemesterId || refreshed.schedule.selectedSemesterId
    }, binding, refreshed.exams, refreshed.fetchedAt)
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

async function countDocuments(collectionName, where) {
  try {
    let query = getDatabase().collection(collectionName);

    if (where) {
      query = query.where(where);
    }

    const result = await query.count();

    return Number(result.total) || 0;
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return 0;
    }

    throw error;
  }
}

async function getLatestDocuments(collectionName, fields, orderField, limit) {
  try {
    let query = getDatabase()
      .collection(collectionName)
      .field(fields);

    if (orderField) {
      query = query.orderBy(orderField, 'desc');
    }

    const result = await query
      .limit(limit)
      .get();

    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return [];
    }

    throw error;
  }
}

function maskOpenId(openid) {
  const value = String(openid || '');

  if (value.length <= 10) {
    return value ? `${value.slice(0, 2)}****` : '';
  }

  return `${value.slice(0, 6)}****${value.slice(-4)}`;
}

function getArrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function getScheduleCourseCount(schedule) {
  const groups = splitSemesterCourseGroups(schedule);

  if (groups.length > 0) {
    return groups.reduce((total, group) => total + getArrayLength(group.courses), 0);
  }

  return getArrayLength(schedule && schedule.courses);
}

function formatBindingUser(binding) {
  const profile = binding.profile || {};
  const schedule = binding.lastSchedule || {};
  const grades = binding.lastGrades || {};
  const studentId = binding.studentId || profile.studentId || profile.maskedStudentId || '';
  const courseCount = getScheduleCourseCount(schedule);
  const examCount = getArrayLength(binding.lastExams);
  const semesterCount = getArrayLength(grades.semesters);
  const majorText = [profile.major, profile.className]
    .filter(Boolean)
    .join(' · ') || '暂无专业班级';

  return {
    id: binding._id || binding._openid || '',
    openidText: maskOpenId(binding._openid || binding._id),
    name: profile.name || '未命名学生',
    studentId: maskStudentId(studentId),
    schoolName: binding.schoolName || '',
    major: profile.major || '暂无专业信息',
    className: profile.className || '',
    majorText,
    lastFetchedText: formatDateTimeText(binding.lastFetchedAt),
    updatedText: formatDateTimeText(binding.updatedAt || binding.createdAt),
    cacheText: `${courseCount}门课 · ${examCount}场考试 · ${semesterCount}学期成绩`
  };
}

function getFeedbackStatusText(status) {
  const map = {
    pending: '待处理',
    processing: '处理中',
    resolved: '已解决',
    closed: '已关闭'
  };

  return map[status] || map.pending;
}

function getFeedbackStatusIndex(status) {
  const statuses = ['pending', 'processing', 'resolved', 'closed'];
  const index = statuses.indexOf(status);

  return index >= 0 ? index : 0;
}

function formatFeedbackItem(item) {
  const status = item.status || 'pending';

  return {
    id: item._id || '',
    type: item.type || '体验建议',
    content: item.content || '',
    contact: item.contact || '',
    status,
    statusIndex: getFeedbackStatusIndex(status),
    statusText: getFeedbackStatusText(status),
    createdText: formatDateTimeText(item.createdAt || item.createdAtIso),
    userText: item.studentName || item.studentId || maskOpenId(item._openid),
    schoolName: item.schoolName || ''
  };
}

async function submitFeedback(event) {
  const openid = getOpenId();
  const type = sanitizeText(event.type, 30) || '体验建议';
  const content = sanitizeText(event.content, 500);
  const contact = sanitizeText(event.contact, 80);

  if (!content) {
    throw new PublicError('请填写反馈内容', 'INVALID_INPUT');
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const binding = await readBinding(openid);
  const profile = binding && binding.profile || {};

  const result = await db.collection(FEEDBACK_COLLECTION).add({
    data: {
      _openid: openid,
      type,
      content,
      contact,
      status: 'pending',
      studentId: binding && binding.studentId ? maskStudentId(binding.studentId) : '',
      studentName: profile.name || '',
      schoolId: binding ? getSchoolIdFromBinding(binding) : '',
      schoolName: binding && binding.schoolName || '',
      createdAt: db.serverDate(),
      createdAtIso: now,
      updatedAt: db.serverDate()
    }
  });

  return {
    success: true,
    data: {
      id: result._id || '',
      type,
      content,
      contact,
      status: 'pending',
      statusText: getFeedbackStatusText('pending'),
      createdAt: now,
      dateText: formatDateTimeText(now)
    }
  };
}

async function getAdminDashboard(event = {}) {
  const adminOpenid = assertAdmin();
  const limit = Math.min(Math.max(Number(event.limit) || 30, 1), 100);
  const db = getDatabase();
  const [userCount, feedbackCount, pendingFeedbackCount, users, feedback] = await Promise.all([
    countDocuments(BINDING_COLLECTION),
    countDocuments(FEEDBACK_COLLECTION),
    countDocuments(FEEDBACK_COLLECTION, { status: 'pending' }),
    getLatestDocuments(BINDING_COLLECTION, {
      _id: true,
      _openid: true,
      schoolName: true,
      studentId: true,
      profile: true,
      lastSchedule: true,
      lastExams: true,
      lastGrades: true,
      lastFetchedAt: true,
      createdAt: true,
      updatedAt: true
    }, 'updatedAt', limit),
    getLatestDocuments(FEEDBACK_COLLECTION, {
      _id: true,
      _openid: true,
      type: true,
      content: true,
      contact: true,
      status: true,
      studentId: true,
      studentName: true,
      schoolName: true,
      createdAt: true,
      createdAtIso: true
    }, 'createdAt', limit)
  ]);

  return {
    success: true,
    data: {
      admin: {
        openidText: maskOpenId(adminOpenid)
      },
      stats: [
        { key: 'users', label: '绑定用户', value: userCount },
        { key: 'feedback', label: '反馈总数', value: feedbackCount },
        { key: 'pending', label: '待处理', value: pendingFeedbackCount }
      ],
      users: users.map(formatBindingUser),
      feedback: feedback.map(formatFeedbackItem),
      loadedAt: new Date().toISOString()
    }
  };
}

async function updateFeedbackStatus(event) {
  assertAdmin();

  const feedbackId = sanitizeText(event.feedbackId || event.id, 80);
  const status = sanitizeText(event.status, 20);
  const allowedStatuses = ['pending', 'processing', 'resolved', 'closed'];

  if (!feedbackId) {
    throw new PublicError('缺少反馈记录', 'INVALID_INPUT');
  }

  if (!allowedStatuses.includes(status)) {
    throw new PublicError('反馈状态无效', 'INVALID_INPUT');
  }

  await getDatabase().collection(FEEDBACK_COLLECTION).doc(feedbackId).update({
    data: {
      status,
      handledAt: getDatabase().serverDate(),
      updatedAt: getDatabase().serverDate()
    }
  });

  return {
    success: true,
    data: {
      id: feedbackId,
      status,
      statusText: getFeedbackStatusText(status)
    }
  };
}

async function directFetch(event) {
  const school = getRequestedSchool(event);
  const studentId = String(event.studentId || '').trim();
  const password = String(event.password || '');

  if (!studentId || !password) {
    throw new PublicError('请填写学号和密码', 'INVALID_INPUT');
  }

  const { schedule, profile, exams } = await fetchScheduleByCredentials(studentId, password, {
    includeProfile: true,
    includeExams: true,
    semesterId: event.semesterId,
    schoolId: school.id
  });

  return {
    success: true,
    data: {
      ...schedule,
      exams,
      profile,
      school: toPublicSchool(school)
    }
  };
}

function getSupportedSchools() {
  return {
    success: true,
    data: {
      defaultSchoolId: DEFAULT_SCHOOL_ID,
      schools: listSchools()
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

    if (action === 'schools') {
      return getSupportedSchools();
    }

    if (action === 'status') {
      return await getBindingStatus();
    }

    if (action === 'profile') {
      return await getBoundProfile();
    }

    if (action === 'grades') {
      return await getBoundGrades(input);
    }

    if (action === 'saveProfile') {
      return await saveBoundProfile(input);
    }

    if (action === 'refresh') {
      return await refreshScheduleCache(input);
    }

    if (action === 'refreshAll') {
      return await refreshAllCaches();
    }

    if (action === 'unbind') {
      return await unbindAccount();
    }

    if (action === 'submitFeedback') {
      return await submitFeedback(input);
    }

    if (action === 'getTermWeekConfig') {
      return await getTermWeekConfig(input);
    }

    if (action === 'submitTermWeekReport') {
      return await submitTermWeekReport(input);
    }

    if (action === 'adminDashboard') {
      return await getAdminDashboard(input);
    }

    if (action === 'adminUpdateFeedback') {
      return await updateFeedbackStatus(input);
    }

    if (action === 'adminSaveTermWeekConfig') {
      return await adminSaveTermWeekConfig(input);
    }

    if (action === 'adminListTermWeekConfigs') {
      return await adminListTermWeekConfigs(input);
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

