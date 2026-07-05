/* Run with: npm run seed
   Creates the initial admin user (from .env) and a few default categories
   so the admin dashboard isn't empty on first login. */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Category = require("../models/Category");
const logger = require("./logger");

async function seed() {
  await connectDB();

  const email = process.env.ADMIN_EMAIL || "admin@coinosprey.com";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const name = process.env.ADMIN_NAME || "CoinOsprey Admin";

  let admin = await User.findOne({ email });
  if (!admin) {
    admin = await User.create({ name, email, password, role: "admin" });
    logger.info(`Created admin user: ${email} (password from .env — change it after first login)`);
  } else {
    logger.info(`Admin user already exists: ${email}`);
  }

  const defaultCategories = ["Bitcoin", "Ethereum", "Altcoins", "DeFi", "NFTs", "Regulation", "Market Analysis"];
  for (const name of defaultCategories) {
    const exists = await Category.findOne({ name });
    if (!exists) {
      await Category.create({ name });
      logger.info(`Created category: ${name}`);
    }
  }

  logger.info("Seed complete.");
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  logger.error(err);
  process.exit(1);
});
