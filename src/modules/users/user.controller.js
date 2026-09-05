import catchAsync from '../../utils/catchAsync.js';
import { created, noContent, ok, paginated } from '../../utils/response.js';
import * as userService from './user.service.js';

export const listUsers = catchAsync(async (req, res) => {
  const { page, limit, q } = req.validatedQuery;
  const { items, total } = await userService.list({ page, limit, q });
  return paginated(res, items, { page, limit, total });
});

export const getUser = catchAsync(async (req, res) => {
  return ok(res, await userService.getById(req.params.id));
});

export const createUser = catchAsync(async (req, res) => {
  return created(res, await userService.create(req.body));
});

export const updateUser = catchAsync(async (req, res) => {
  return ok(res, await userService.update(req.params.id, req.body));
});

export const deleteUser = catchAsync(async (req, res) => {
  await userService.remove(req.params.id);
  return noContent(res);
});
