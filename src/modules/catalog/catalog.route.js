import { Router } from 'express';
import { z } from 'zod';

import validate from '../../middlewares/validate.js';
import * as controller from './catalog.controller.js';

const router = Router();

router.get('/provinces', controller.listProvinces);
router.get(
  '/provinces/:code/wards',
  validate({ params: z.object({ code: z.string().regex(/^\d{2}$/, 'code is 2 digits') }) }),
  controller.listWards
);
router.get('/amenities', controller.listAmenities);

export default router;
