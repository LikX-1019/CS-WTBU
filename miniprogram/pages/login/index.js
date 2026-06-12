const { callGetSchedule, toMessage } = require('../../utils/api');
const { markBound } = require('../../utils/auth');
const { setProfile, setSchedule } = require('../../utils/dataStore');

Page({
  data: {
    studentId: '',
    password: '',
    binding: false
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

  async bindAccount() {
    const { studentId, password, binding } = this.data;

    if (binding) {
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
        studentId,
        password
      }, '课表获取失败');

      setSchedule(data);
      markBound(true);
      if (data.profile) {
        setProfile({
          profile: data.profile,
          studentId: data.studentId || studentId
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
