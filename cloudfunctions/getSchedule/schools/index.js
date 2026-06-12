const wtbu = require('./wtbu');

const DEFAULT_SCHOOL_ID = wtbu.id;

const adapters = [
  wtbu
];

const schools = adapters.map((adapter) => ({
  id: adapter.id,
  name: adapter.name,
  aliases: adapter.aliases,
  eduSystemUrl: adapter.eduSystemUrl,
  adapter
}));

function normalizeSchoolId(schoolId) {
  return String(schoolId || DEFAULT_SCHOOL_ID).trim() || DEFAULT_SCHOOL_ID;
}

function getSchool(schoolId) {
  const normalizedId = normalizeSchoolId(schoolId);

  return schools.find((school) => school.id === normalizedId) || null;
}

function toPublicSchool(school) {
  if (!school) {
    return null;
  }

  return {
    id: school.id,
    name: school.name,
    aliases: Array.isArray(school.aliases) ? school.aliases : [],
    eduSystemUrl: school.eduSystemUrl || ''
  };
}

function listSchools() {
  return schools.map(toPublicSchool);
}

module.exports = {
  DEFAULT_SCHOOL_ID,
  getSchool,
  listSchools,
  normalizeSchoolId,
  toPublicSchool
};
