const { goTab } = require('../../utils/nav');
const { ensureBound, redirectToLogin } = require('../../utils/auth');
const { loadProfile, saveProfile } = require('../../utils/dataStore');
const { formatProfile, getEmptyProfile } = require('../../utils/schedule');
const { getCustomNavStyle } = require('../../utils/system');

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

Page({
  data: Object.assign({}, getCustomNavStyle(), formatProfile(getEmptyProfile()), {
    loading: false,
    errorText: '',
    rawProfile: getEmptyProfile(),
    editVisible: false,
    savingProfile: false,
    savingAvatar: false,
    editRows: [],
    actions: [
      { label: '设置', icon: 'settings', url: '/pages/settings/index' },
      { label: '关于我们', icon: 'about', url: '/pages/about/index' },
      { label: '意见反馈', icon: 'feedback', url: '/pages/feedback/index' }
    ]
  }),

  onShow() {
    this.loadProfile();
  },

  onPullDownRefresh() {
    this.loadProfile({ force: true }).finally(() => {
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

      this.setProfileData(data.profile);
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

  setProfileData(profile) {
    const rawProfile = Object.assign({}, getEmptyProfile(), profile || {});

    this.setData(Object.assign({}, formatProfile(rawProfile), {
      rawProfile
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
    const url = event.currentTarget.dataset.url;

    if (!url) {
      return;
    }

    wx.navigateTo({ url });
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

      this.setProfileData(data.profile);
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

      this.setProfileData(data.profile);
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
});
