import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireRole } from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import catchAsync from '../../utils/catchAsync.js';
import * as listingService from '../listings/listing.service.js';
import * as reportService from '../listings/report.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const idParams = z.object({ id: z.string().uuid('id must be a UUID') });
const page = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
};

// ---------------------------------------------------------------- listings

router.get(
  '/listings',
  validate({
    query: z.object({
      status: z.enum(['pending', 'active', 'rejected', 'rented', 'hidden']).default('pending'),
      ...page,
    }),
  }),
  catchAsync(async (req, res) => {
    const { items, total } = await listingService.moderationQueue(req.validatedQuery);
    return res.paginated(items, { ...req.validatedQuery, total });
  })
);

router.patch(
  '/listings/:id',
  validate({
    params: idParams,
    body: z.discriminatedUnion('action', [
      z.object({ action: z.literal('approve') }),
      // The owner sees this reason, so it is required and should say what to fix.
      z.object({ action: z.literal('reject'), reason: z.string().trim().min(5).max(500) }),
      z.object({ action: z.literal('hide') }),
    ]),
  }),
  catchAsync(async (req, res) => {
    return res.ok(await listingService.moderate(req.params.id, req.user, req.body));
  })
);

// ----------------------------------------------------------------- reports

router.get(
  '/reports',
  validate({
    query: z.object({ status: z.enum(['open', 'resolved', 'dismissed']).default('open'), ...page }),
  }),
  catchAsync(async (req, res) => {
    const { items, total } = await reportService.list(req.validatedQuery);
    return res.paginated(items, { ...req.validatedQuery, total });
  })
);

router.patch(
  '/reports/:id',
  validate({
    params: idParams,
    body: z.object({
      status: z.enum(['resolved', 'dismissed']),
      hideListing: z.boolean().default(false),
    }),
  }),
  catchAsync(async (req, res) => {
    await reportService.resolve(req.params.id, req.user, req.body);
    return res.noContent();
  })
);

export default router;
