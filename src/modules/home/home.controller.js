import catchAsync from '../../utils/catchAsync.js';
import * as homeService from './home.service.js';

export const listActions = catchAsync(async (_req, res) => {
  return res.ok(homeService.listActions());
});
