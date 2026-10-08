import { Router } from 'express';
import authRoutes from '../modules/auth/auth.route.js';
import homeRoutes from '../modules/home/home.route.js';
import userRoutes from '../modules/users/user.route.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/home', homeRoutes);
router.use('/users', userRoutes);

export default router;
