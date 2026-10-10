import catchAsync from '../../utils/catchAsync.js';
import * as catalogService from './catalog.service.js';

// The catalogue only changes with a deploy, so clients and CDNs may cache it.
const cacheable = (res) => res.set('cache-control', 'public, max-age=3600');

export const listProvinces = catchAsync(async (_req, res) => {
  return cacheable(res).ok(await catalogService.listProvinces());
});

export const listWards = catchAsync(async (req, res) => {
  return cacheable(res).ok(await catalogService.listWards(req.params.code));
});

export const listAmenities = catchAsync(async (_req, res) => {
  return cacheable(res).ok(await catalogService.listAmenities());
});
