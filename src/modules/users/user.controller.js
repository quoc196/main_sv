import catchAsync from '../../utils/catchAsync.js';
import * as userService from './user.service.js';

export const listUsers = catchAsync(async (req, res) => {
  const { page, limit, q } = req.validatedQuery;
  const { items, total } = await userService.list({ page, limit, q });
  return res.paginated(items, { page, limit, total });
});

export const getUser = catchAsync(async (req, res) => {
  return res.ok(await userService.getById(req.params.id));
});

export const createUser = catchAsync(async (req, res) => {
  return res.created(await userService.create(req.body), { message: 'Tạo user thành công' });
});

export const updateUser = catchAsync(async (req, res) => {
  return res.ok(await userService.update(req.params.id, req.body), {
    message: 'Cập nhật user thành công',
  });
});

export const deleteUser = catchAsync(async (req, res) => {
  await userService.remove(req.params.id);
  return res.noContent();
});
