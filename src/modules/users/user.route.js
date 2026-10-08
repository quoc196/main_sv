import { Router } from 'express';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as controller from './user.controller.js';
import {
  createUserSchema,
  getUserSchema,
  listUsersSchema,
  updateUserSchema,
} from './user.validation.js';

const router = Router();

// Managing other accounts is an admin job. A user reads and edits their own
// profile through /auth/me instead.
router.use(requireAuth, requireRole('admin'));

router
  .route('/')
  .get(validate(listUsersSchema), controller.listUsers)
  .post(validate(createUserSchema), controller.createUser);

router
  .route('/:id')
  .get(validate(getUserSchema), controller.getUser)
  .patch(validate(updateUserSchema), controller.updateUser)
  .delete(validate(getUserSchema), controller.deleteUser);

export default router;
