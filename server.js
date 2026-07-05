require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");
const logger = require("./middleware/utils/logger");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./middleware/routes/authRoutes");
const articleRoutes = require("./routes/articleRoutes");
const commentRoutes = require("./routes/commentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");
const seoRoutes = require("./routes/seoRoutes");
const apiRoutes = require("./routes/apiRoutes");
const { sitemap, robots } = require("./controllers/seoController");

const app = express();

// ---------- Core middleware ----------
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Basic rate limiting on write-heavy/auth endpoints to slow down abuse.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
const commentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use("/api/auth", authLimiter);
app.use("/api/comments", commentLimiter);

// Serve uploaded images
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));

// ---------- Routes ----------
app.get("/", (req, res) => res.json({ success: true, message: "CoinOsprey API is running." }));
app.get("/sitemap.xml", sitemap);
app.get("/robots.txt", robots);

app.use("/api/auth", authRoutes);
app.use("/api/articles", articleRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/seo", seoRoutes);
app.use("/api/crypto", apiRoutes);

// ---------- Error handling ----------
app.use(notFound);
app.use(errorHandler);

// ---------- Start ----------
const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`CoinOsprey API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  });
}

start();

module.exports = app;
