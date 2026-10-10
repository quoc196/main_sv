import { Router } from 'express';
import multer from 'multer';

import { optionalAuth, requireAuth } from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import ApiError from '../../utils/ApiError.js';
import * as controller from './listing.controller.js';
import { MAX_IMAGES, MAX_IMAGE_BYTES } from './image.service.js';
import {
  createListingSchema,
  imageParamsSchema,
  listingIdSchema,
  myListingsSchema,
  pageSchema,
  reportSchema,
  searchListingsSchema,
  setStatusSchema,
  updateListingSchema,
} from './listing.validation.js';

const router = Router();

// Held in memory only long enough to stream to storage; the limits bound that.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
}).array('images', MAX_IMAGES);

/** multer's own errors carry no HTTP status, so they would surface as 500s. */
function uploadImages(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return next(
        new ApiError(tooBig ? 413 : 400, `Upload rejected: ${err.code}`, {
          userMessage: tooBig
            ? `Mỗi ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024}MB`
            : `Tối đa ${MAX_IMAGES} ảnh, gửi trong trường "images"`,
          cause: err,
        })
      );
    }
    next(err);
  });
}

// Fixed paths first, so "mine" and "favorites" are never read as an :id.
router.get('/', validate(searchListingsSchema), controller.search);
router.get('/mine', requireAuth, validate(myListingsSchema), controller.listMine);
router.get('/favorites', requireAuth, validate(pageSchema), controller.listFavorites);
router.post('/', requireAuth, validate(createListingSchema), controller.create);

router.get('/:id', optionalAuth, validate(listingIdSchema), controller.getById);
router.patch('/:id', requireAuth, validate(updateListingSchema), controller.update);
router.delete('/:id', requireAuth, validate(listingIdSchema), controller.remove);
router.patch('/:id/status', requireAuth, validate(setStatusSchema), controller.setStatus);
router.post('/:id/refresh', requireAuth, validate(listingIdSchema), controller.refresh);

router.post(
  '/:id/images',
  requireAuth,
  validate(listingIdSchema),
  uploadImages,
  controller.addImages
);
router.delete(
  '/:id/images/:imageId',
  requireAuth,
  validate(imageParamsSchema),
  controller.removeImage
);

router.put('/:id/favorite', requireAuth, validate(listingIdSchema), controller.addFavorite);
router.delete('/:id/favorite', requireAuth, validate(listingIdSchema), controller.removeFavorite);
router.post('/:id/reports', requireAuth, validate(reportSchema), controller.report);

export default router;
