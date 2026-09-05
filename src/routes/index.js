import { Router } from 'express';
import userRoutes from '../modules/users/user.route.js';

const router = Router();

router.use('/users', userRoutes);

export default router;
