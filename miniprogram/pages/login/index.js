const { callGetSchedule, toMessage } = require('../../utils/api');
const { markBound } = require('../../utils/auth');
const { setCurrentSchedule, setGrades, setProfile, setSchedule } = require('../../utils/dataStore');
const { getCustomNavStyle } = require('../../utils/system');

const DEFAULT_SCHOOL = {
  id: 'wtbu',
  name: '武汉工商学院',
  aliases: ['武汉工商学院', '武工商', 'WTBU', 'wtbu'],
  eduSystemUrl: 'https://jxgl.wtbu.edu.cn/eams/home.action'
};

function normalizeSchools(value) {
  const schools = Array.isArray(value) ? value : [];
  const normalized = schools
    .map((school) => ({
      id: String(school.id || '').trim(),
      name: String(school.name || '').trim(),
      aliases: Array.isArray(school.aliases) ? school.aliases.map((alias) => String(alias || '').trim()).filter(Boolean) : [],
      eduSystemUrl: String(school.eduSystemUrl || '').trim()
    }))
    .filter((school) => school.id && school.name);

  return normalized.length > 0 ? normalized : [DEFAULT_SCHOOL];
}

function getSchoolSearchText(school) {
  return [
    school.name,
    school.id,
    ...(Array.isArray(school.aliases) ? school.aliases : [])
  ].join(' ').toLowerCase();
}

function filterSchools(schools, keyword) {
  const text = String(keyword || '').trim().toLowerCase();

  if (!text) {
    return schools;
  }

  return schools.filter((school) => getSchoolSearchText(school).includes(text));
}

function pickSchool(schools, schoolId) {
  return schools.find((school) => school.id === schoolId) || schools[0] || DEFAULT_SCHOOL;
}

Page({
  data: Object.assign({}, getCustomNavStyle(), {
    schools: [DEFAULT_SCHOOL],
    filteredSchools: [DEFAULT_SCHOOL],
    selectedSchoolId: DEFAULT_SCHOOL.id,
    schoolSearchText: DEFAULT_SCHOOL.name,
    schoolDropdownVisible: false,
    studentId: '',
    password: '',
    binding: false
  }),

  onLoad() {
    this.loadSchools();
  },

  async loadSchools() {
    try {
      const data = await callGetSchedule({ action: 'schools' }, '学校列表加载失败');
      const schools = normalizeSchools(data.schools);
      const selectedSchool = pickSchool(schools, data.defaultSchoolId || this.data.selectedSchoolId);

      this.setData({
        schools,
        filteredSchools: schools,
        selectedSchoolId: selectedSchool.id,
        schoolSearchText: selectedSchool.name
      });
    } catch (error) {
      this.setData({
        schools: [DEFAULT_SCHOOL],
        filteredSchools: [DEFAULT_SCHOOL],
        selectedSchoolId: DEFAULT_SCHOOL.id,
        schoolSearchText: DEFAULT_SCHOOL.name
      });
    }
  },

  goBack() {
    const pages = getCurrentPages();

    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.reLaunch({
      url: '/pages/home/index'
    });
  },

  onStudentIdInput(event) {
    this.setData({
      studentId: event.detail.value.trim()
    });
  },

  onPasswordInput(event) {
    this.setData({
      password: event.detail.value
    });
  },

  showSchoolDropdown() {
    this.setData({
      schoolDropdownVisible: true,
      filteredSchools: filterSchools(this.data.schools, '')
    });
  },

  onSchoolSearchInput(event) {
    const schoolSearchText = event.detail.value;
    const filteredSchools = filterSchools(this.data.schools, schoolSearchText);
    const selectedSchool = filteredSchools.length === 1 ? filteredSchools[0] : null;

    this.setData({
      schoolSearchText,
      filteredSchools,
      selectedSchoolId: selectedSchool ? selectedSchool.id : ''
    });
  },

  onSchoolSelect(event) {
    const schoolId = event.currentTarget.dataset.schoolId;
    const school = this.data.schools.find((item) => item.id === schoolId);

    if (!school) {
      return;
    }

    this.setData({
      selectedSchoolId: school.id,
      schoolSearchText: school.name,
      filteredSchools: [school],
      schoolDropdownVisible: false
    });
  },

  async bindAccount() {
    const { selectedSchoolId, studentId, password, binding } = this.data;

    if (binding) {
      return;
    }

    if (!selectedSchoolId) {
      wx.showToast({
        title: '请选择学校',
        icon: 'none'
      });
      return;
    }

    if (!studentId || !password) {
      wx.showToast({
        title: '请填写学号和密码',
        icon: 'none'
      });
      return;
    }

    this.setData({ binding: true });

    try {
      const data = await callGetSchedule({
        action: 'bind',
        schoolId: selectedSchoolId,
        studentId,
        password
      }, '课表获取失败');

      setSchedule(data);
      setCurrentSchedule(data);
      if (data.grades) {
        setGrades(data.grades);
      }
      markBound(true);
      if (data.profile) {
        setProfile({
          profile: data.profile,
          studentId: data.studentId || studentId,
          isAdmin: Boolean(data.isAdmin)
        });
      }
      wx.reLaunch({
        url: '/pages/schedule/index'
      });
    } catch (error) {
      wx.showToast({
        title: error.messageText || toMessage(error, '课表获取失败'),
        icon: 'none',
        duration: 2200
      });
    } finally {
      this.setData({ binding: false });
    }
  }
});
