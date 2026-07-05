/* ==============================================================
   CoinOsprey Backend — server.js
   Entry point: loads env vars, connects to MongoDB, wires up
   global middleware, mounts all route modules, and starts the
   HTTP server. Keep this file thin — actual logic lives in
   controllers/services; this file only assembles the app.
   ============================================================== */

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const path = require("path");

const connectDB = require("./config/db");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");

// Route modules
const authRoutes = require("./routes/authRoutes");
const articleRoutes = require("./routes/articleRoutes");
const commentRoutes = require("./routes/commentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");
const seoRoutes = require("./routes/seoRoutes");
const apiRoutes = require("./routes/apiRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------------------------------------------------------------
   1. Database
--------------------------------------------------------------- */
connectDB();

/* ---------------------------------------------------------------
   2. Core middleware
--------------------------------------------------------------- */
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// HTTP request logging — concise in production, verbose in dev
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Global rate limiter — protects auth/comment/newsletter endpoints from abuse.
// Individual routes can layer stricter limiters on top if needed.
const globalLimiter = rateLimit({
  windowMs: (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});
app.use("/api", globalLimiter);

// Serve uploaded files (article cover images, avatars, etc.)
app.use("/public", express.static(path.join(__dirname, "public")));

/* ---------------------------------------------------------------
   3. Routes
--------------------------------------------------------------- */
app.get("/health", (req, res) => {
  res.status(200).json({ success: true, message: "CoinOsprey API is running", env: process.env.NODE_ENV });
});

app.use("/api/auth", authRoutes);
app.use("/api/articles", articleRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/data", apiRoutes);       // live crypto prices / global stats / fear&greed proxy
app.use("/", seoRoutes);               // sitemap.xml, robots.txt live at the domain root

/* ---------------------------------------------------------------
   4. 404 + error handling (must be last)
--------------------------------------------------------------- */
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

/* ---------------------------------------------------------------
   5. Start server
--------------------------------------------------------------- */
const server = app.listen(PORT, () => {
  logger.info(`CoinOsprey API listening on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
});

// Fail loudly instead of leaving the process in a broken state
process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});
