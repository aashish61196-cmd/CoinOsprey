require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// ---- Route imports ----
const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');
const commentRoutes = require('./routes/commentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
const seoRoutes = require('./routes/seoRoutes');
const apiRoutes = require('./routes/apiRoutes');

const app = express();

// ---- Connect to database ----
connectDB();

// ---- Core middleware ----
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true, // required so the refreshToken cookie is accepted cross-origin
}));
app.use(express.json({ limit: '2mb' })); // higher limit for large article HTML bodies
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- Static file serving (uploaded images) ----
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// ---- Request logging ----
app.use((req, res, next) => {
  logger.logRequest(req);
  next();
});

// ---- Routes ----
app.use('/api/auth', authRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/newsletter', newsletterRoutes);
app.use('/api/seo', seoRoutes);
app.use('/api/data', apiRoutes);

// ---- 404 handler for unmatched API routes ----
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// ---- Centralized error handler (must be last) ----
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(`AVFINANCEHUB backend running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// ---- Graceful shutdown ----
process.on('unhandledRejection', (err) => {
  logger.logError(err, 'unhandledRejection');
  process.exit(1);
});

module.exports = app;
