import { Router } from 'express';

import { requireAuth } from '../../middlewares/auth.js';
import * as controller from './home.controller.js';

const router = Router();

// Public: the home screen shows its actions before login too.
router.get('/actions', controller.listActions);

// Every home route declared below this line needs a signed-in user.
router.use(requireAuth);

export default router;
