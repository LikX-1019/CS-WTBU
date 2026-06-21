const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadProfile, refreshEduCache, saveProfile } = require('../../utils/dataStore');
const { formatProfile, getEmptyProfile } = require('../../utils/schedule');
const { getCustomNavStyle } = require('../../utils/system');
const { withShare } = require('../../utils/share');

const EDIT_FIELDS = [
  { key: 'name', label: '姓名' },
  { key: 'major', label: '专业' },
  { key: 'grade', label: '年级' },
  { key: 'level', label: '层次' },
  { key: 'className', label: '班级' },
  { key: 'gender', label: '性别' },
  { key: 'birthDate', label: '出生年月' },
  { key: 'politicalStatus', label: '政治面貌' },
  { key: 'phone', label: '手机号' },
  { key: 'email', label: '邮箱' },
  { key: 'nativePlace', label: '籍贯' },
  { key: 'enrollmentDate', label: '入学时间' },
  { key: 'studentStatus', label: '学生状态' },
  { key: 'dormitory', label: '宿舍信息' },
  { key: 'counselor', label: '辅导员' }
];

function buildEditRows(profile) {
  const source = profile || {};

  return EDIT_FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    value: source[field.key] ? String(source[field.key]) : ''
  }));
}

function buildActions(isAdmin) {
  const actions = [
    { label: '从教务系统更新数据库', icon: 'refresh', action: 'refreshEdu' }
  ];

  if (isAdmin) {
    actions.push({ label: '管理员后台', icon: 'admin', url: '/pages/admin/index' });
  }

  return actions.concat([
    { label: '设置', icon: 'settings', url: '/pages/settings/index' },
    { label: '关于我们', icon: 'about', url: '/pages/about/index' },
    { label: '意见反馈', icon: 'feedback', url: '/pages/feedback/index' }
  ]);
}

Page(withShare({
  data: Object.assign({}, getCustomNavStyle(), formatProfile(getEmptyProfile()), {
    loading: false,
    errorText: '',
    rawProfile: getEmptyProfile(),
    editVisible: false,
    savingProfile: false,
    savingAvatar: false,
    refreshingEdu: false,
    editRows: [],
    isAdmin: false,
    actions: buildActions(false)
  }),

  onShow() {
    this.loadProfile();
  },

  onPullDownRefresh() {
    this.loadProfile().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadProfile(options = {}) {
    if (this.data.loading) {
      return;
    }

    this.setData({
      loading: true,
      errorText: ''
    });

    try {
      await ensureBound();
      const data = await loadProfile(options);

      this.setProfileData(data.profile, data.isAdmin, data.lastFetchedAt);
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      this.setData({
        errorText: error.messageText || error.message || '个人信息加载失败'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  setProfileData(profile, isAdmin, lastFetchedAt = '') {
    const rawProfile = Object.assign({}, getEmptyProfile(), profile || {});
    const adminVisible = Boolean(isAdmin);

    this.setData(Object.assign({}, formatProfile(rawProfile), {
      rawProfile,
      isAdmin: adminVisible,
      actions: buildActions(adminVisible)
    }));
  },

  openProfileEditor() {
    this.setData({
      editVisible: true,
      editRows: buildEditRows(this.data.rawProfile)
    });
  },

  closeProfileEditor() {
    if (this.data.savingProfile) {
      return;
    }

    this.setData({
      editVisible: false
    });
  },

  noop() {},

  openAction(event) {
    const action = event.currentTarget.dataset.action;
    const url = event.currentTarget.dataset.url;

    if (action === 'refreshEdu') {
      this.confirmRefreshEduCache();
      return;
    }

    if (!url) {
      return;
    }

    wx.navigateTo({ url });
  },

  confirmRefreshEduCache() {
    if (this.data.refreshingEdu) {
      return;
    }

    wx.showModal({
      title: '更新数据库',
      content: '\u5c06\u4ece\u6559\u52a1\u7cfb\u7edf\u91cd\u65b0\u83b7\u53d6\u8bfe\u8868\u3001\u8003\u8bd5\u548c\u6210\u7ee9\u6570\u636e\u3002',
      confirmText: '更新',
      confirmColor: '#2f7bff',
      success: (result) => {
        if (result.confirm) {
          this.refreshEduCache();
        }
      }
    });
  },

  async refreshEduCache() {
    if (this.data.refreshingEdu) {
      return;
    }

    this.setData({ refreshingEdu: true });

    try {
      await ensureBound();
      const data = await refreshEduCache();

      wx.showToast({
        title: data.refreshedAt ? '数据库已更新' : '更新完成',
        icon: 'success'
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      wx.showToast({
        title: error.messageText || error.message || '教务系统更新失败',
        icon: 'none'
      });
    } finally {
      this.setData({ refreshingEdu: false });
    }
  },

  async onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;

    if (!avatarUrl || this.data.savingAvatar) {
      return;
    }

    this.setData({ savingAvatar: true });

    try {
      await ensureBound();
      const extMatch = avatarUrl.match(/\.[a-z0-9]+(?=($|\?))/i);
      const ext = extMatch ? extMatch[0] : '.jpg';
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath: `avatars/${Date.now()}${ext}`,
        filePath: avatarUrl
      });
      const data = await saveProfile(Object.assign({}, this.data.rawProfile, {
        avatarUrl: uploadResult.fileID
      }));

      this.setProfileData(data.profile, data.isAdmin);
      wx.showToast({
        title: '头像已更新',
        icon: 'success'
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      wx.showToast({
        title: error.messageText || error.errMsg || error.message || '头像保存失败',
        icon: 'none'
      });
    } finally {
      this.setData({ savingAvatar: false });
    }
  },

  onProfileFieldInput(event) {
    const index = Number(event.currentTarget.dataset.index);

    if (isNaN(index) || index < 0 || !this.data.editRows[index]) {
      return;
    }

    this.setData({
      [`editRows[${index}].value`]: event.detail.value
    });
  },

  async saveProfileEdit() {
    if (this.data.savingProfile) {
      return;
    }

    this.setData({ savingProfile: true });

    try {
      const profile = {};

      this.data.editRows.forEach((row) => {
        profile[row.key] = row.value;
      });

      const data = await saveProfile(profile);

      this.setProfileData(data.profile, data.isAdmin);
      this.setData({ editVisible: false });
      wx.showToast({
        title: '已保存',
        icon: 'success'
      });
    } catch (error) {
      if (error.code === 'NO_BINDING') {
        redirectToLogin();
        return;
      }

      wx.showToast({
        title: error.messageText || error.message || '保存失败',
        icon: 'none'
      });
    } finally {
      this.setData({ savingProfile: false });
    }
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
}));
