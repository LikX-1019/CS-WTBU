function toMessage(value, fallback) {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value.message && typeof value.message === 'string') {
    return value.message;
  }

  if (value.errMsg && typeof value.errMsg === 'string') {
    return value.errMsg;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return fallback;
  }
}

async function callGetSchedule(data, fallbackMessage) {
  try {
    const response = await wx.cloud.callFunction({
      name: 'getSchedule',
      data: data || {}
    });
    const result = response && response.result ? response.result : {};

    if (!result.success) {
      const error = new Error(toMessage(result.message || result, fallbackMessage));
      error.code = result.code || 'CALL_FAILED';
      throw error;
    }

    return result.data || {};
  } catch (error) {
    error.messageText = toMessage(error, fallbackMessage);
    throw error;
  }
}

module.exports = {
  callGetSchedule,
  toMessage
};
