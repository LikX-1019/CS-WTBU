const { callGetSchedule } = require('./api');
const { setProfile } = require('./dataStore');

let bound = false;
let checked = false;
let checking = null;

function goLogin() {
  const pages = getCurrentPages();
  const current = pages.length ? pages[pages.length - 1].route : '';

  if (current === 'pages/login/index') {
    return;
  }

  wx.reLaunch({ url: '/pages/login/index' });
}

function redirectToLogin() {
  goLogin();
}

async function ensureBound(options = {}) {
  if (!options.force && checked && bound) {
    return true;
  }

  if (!options.force && checking) {
    return checking;
  }

  checking = callGetSchedule({ action: 'status' }, '绑定状态检查失败')
    .then((data) => {
      bound = Boolean(data.bound);
      checked = true;

      if (data.profile) {
        setProfile({
          profile: data.profile,
          studentId: data.studentId || '',
          isAdmin: Boolean(data.isAdmin)
        });
      }

      if (!bound) {
        goLogin();
        const error = new Error('请先绑定教务系统账号');
        error.code = 'NO_BINDING';
        throw error;
      }

      return true;
    })
    .finally(() => {
      checking = null;
    });

  return checking;
}

function markBound(value) {
  bound = Boolean(value);
  checked = true;
}

function resetBindingState() {
  bound = false;
  checked = false;
  checking = null;
}

module.exports = {
  ensureBound,
  markBound,
  redirectToLogin,
  resetBindingState
};
