import { Router } from 'express';

import * as controller from './home.controller.js';

const router = Router();

// Public: the home screen is shown before login too.
router.get('/actions', controller.listActions);

export default router;
