const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 50;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const validateAccountCredentials = (input = {}) => {
  const username = String(input.username || '').trim();
  const password = typeof input.password === 'string' ? input.password : '';

  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
    return {
      error: `Tên đăng nhập phải có từ ${MIN_USERNAME_LENGTH} đến ${MAX_USERNAME_LENGTH} ký tự.`
    };
  }

  if (/\s|[\u0000-\u001F\u007F]/u.test(username)) {
    return { error: 'Tên đăng nhập không được chứa khoảng trắng hoặc ký tự điều khiển.' };
  }

  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      error: `Mật khẩu phải có từ ${MIN_PASSWORD_LENGTH} đến ${MAX_PASSWORD_LENGTH} ký tự.`
    };
  }

  return { username, password, error: null };
};

const normalizeManagedRole = (role) => {
  const normalizedRole = String(role || 'user').toLowerCase();
  return ['user', 'admin'].includes(normalizedRole) ? normalizedRole : null;
};

module.exports = {
  validateAccountCredentials,
  normalizeManagedRole
};
