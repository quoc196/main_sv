import catchAsync from '../../utils/catchAsync.js';
import * as userService from '../users/user.service.js';
import * as authService from './auth.service.js';

export const register = catchAsync(async (req, res) => {
  return res.created(await authService.register(req.body), { message: 'Đăng ký thành công' });
});

export const login = catchAsync(async (req, res) => {
  return res.ok(await authService.login(req.body), { message: 'Đăng nhập thành công' });
});

export const refresh = catchAsync(async (req, res) => {
  return res.ok(await authService.refresh(req.body.refreshToken));
});

export const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  return res.noContent();
});

export const me = catchAsync(async (req, res) => {
  return res.ok(await userService.getById(req.user.id));
});
