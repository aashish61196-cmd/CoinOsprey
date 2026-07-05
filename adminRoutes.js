const express = require('express');
const router = express.Router();

const {
  getDashboardStats,
  getUsers,
  updateUserRole,
  toggleUserStatus,
  createCategory,
  updateCategory,
  deleteCategory,
  getProductionStats,
} = require('../controllers/adminController');

const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/admin');

// ---- All admin routes require authentication + admin role ----
router.use(protect, authorize('admin'));

// ---- Dashboard ----
router.get('/dashboard', getDashboardStats);
router.get('/production-stats', getProductionStats);

// ---- User management ----
router.get('/users', getUsers);
router.patch('/users/:id/role', updateUserRole);
router.patch('/users/:id/status', toggleUserStatus);

// ---- Category management ----
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

module.exports = router;
