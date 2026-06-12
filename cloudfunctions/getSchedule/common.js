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

function maskStudentId(studentId) {
  const value = String(studentId || '');

  if (value.length <= 4) {
    return value;
  }

  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

module.exports = {
  PublicError,
  getErrorMessage,
  maskStudentId
};
