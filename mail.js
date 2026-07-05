/* ==============================================================
   config/mail.js
   Creates a single reusable Nodemailer transporter from the SMTP
   settings in .env. Imported by services/emailService.js — no
   other file should call nodemailer.createTransport directly.
   ============================================================== */

const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT) || 587,
  secure: process.env.MAIL_SECURE === "true", // true for port 465, false for 587/25
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// Verify the connection once on boot so a bad SMTP config shows up
// in the logs immediately instead of failing silently on first send.
transporter.verify((err) => {
  if (err) {
    logger.warn(`Mail transporter verification failed: ${err.message}`);
  } else {
    logger.info("Mail transporter ready");
  }
});

const MAIL_FROM = process.env.MAIL_FROM || `"CoinOsprey" <${process.env.MAIL_USER}>`;

module.exports = { transporter, MAIL_FROM };
