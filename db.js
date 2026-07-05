/* ==============================================================
   config/db.js
   Opens the MongoDB connection via Mongoose. Called once from
   server.js on boot. Exits the process on failure so the app
   never runs silently without a database.
   ============================================================== */

const mongoose = require("mongoose");
const logger = require("../utils/logger");

async function connectDB() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error("MONGO_URI is not set in the environment");

    mongoose.set("strictQuery", true);

    const conn = await mongoose.connect(uri, {
      // Mongoose 8 no longer needs useNewUrlParser/useUnifiedTopology,
      // they're the default behaviour — kept out intentionally.
    });

    logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
    });
    mongoose.connection.on("error", (err) => {
      logger.error(`MongoDB connection error: ${err.message}`);
    });
  } catch (err) {
    logger.error(`MongoDB initial connection failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = connectDB;
