import { Router } from 'express';
import adminRoutes from '../modules/admin/admin.route.js';
import authRoutes from '../modules/auth/auth.route.js';
import catalogRoutes from '../modules/catalog/catalog.route.js';
import homeRoutes from '../modules/home/home.route.js';
import listingRoutes from '../modules/listings/listing.route.js';
import userRoutes from '../modules/users/user.route.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/home', homeRoutes);
router.use('/catalog', catalogRoutes);
router.use('/listings', listingRoutes);
router.use('/admin', adminRoutes);
router.use('/users', userRoutes);

export default router;
