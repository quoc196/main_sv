import catchAsync from '../../utils/catchAsync.js';
import * as favoriteService from './favorite.service.js';
import * as imageService from './image.service.js';
import * as listingService from './listing.service.js';
import * as reportService from './report.service.js';

const paged = (res, { items, total }, { page, limit }) =>
  res.paginated(items, { page, limit, total });

export const search = catchAsync(async (req, res) => {
  return paged(res, await listingService.search(req.validatedQuery), req.validatedQuery);
});

export const getById = catchAsync(async (req, res) => {
  return res.ok(await listingService.getById(req.params.id, req.user, { countView: true }));
});

export const create = catchAsync(async (req, res) => {
  return res.created(await listingService.create(req.user, req.body), {
    message: 'Đã gửi tin, tin sẽ hiển thị sau khi được duyệt',
  });
});

export const update = catchAsync(async (req, res) => {
  return res.ok(await listingService.update(req.params.id, req.user, req.body), {
    message: 'Đã cập nhật, tin sẽ hiển thị lại sau khi được duyệt',
  });
});

export const remove = catchAsync(async (req, res) => {
  await listingService.remove(req.params.id, req.user);
  return res.noContent();
});

export const setStatus = catchAsync(async (req, res) => {
  return res.ok(await listingService.setStatus(req.params.id, req.user, req.body.status));
});

export const refresh = catchAsync(async (req, res) => {
  return res.ok(await listingService.refresh(req.params.id, req.user), {
    message: 'Đã làm mới tin',
  });
});

export const listMine = catchAsync(async (req, res) => {
  return paged(
    res,
    await listingService.listMine(req.user, req.validatedQuery),
    req.validatedQuery
  );
});

export const addImages = catchAsync(async (req, res) => {
  await imageService.add(req.params.id, req.user, req.files);
  return res.created(await listingService.getById(req.params.id, req.user), {
    message: 'Đã tải ảnh lên',
  });
});

export const removeImage = catchAsync(async (req, res) => {
  await imageService.remove(req.params.id, req.params.imageId, req.user);
  return res.noContent();
});

export const listFavorites = catchAsync(async (req, res) => {
  return paged(res, await favoriteService.list(req.user, req.validatedQuery), req.validatedQuery);
});

export const addFavorite = catchAsync(async (req, res) => {
  await favoriteService.add(req.params.id, req.user);
  return res.noContent();
});

export const removeFavorite = catchAsync(async (req, res) => {
  await favoriteService.remove(req.params.id, req.user);
  return res.noContent();
});

export const report = catchAsync(async (req, res) => {
  await reportService.create(req.params.id, req.user, req.body);
  return res.created({}, { message: 'Cảm ơn bạn đã báo cáo, chúng tôi sẽ kiểm tra' });
});
