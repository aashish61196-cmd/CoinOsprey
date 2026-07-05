const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    logger.warn(
      "SMTP is not fully configured (.env). Emails will be logged to the console instead of sent."
    );
    // Fallback "transporter" that just logs — keeps the app usable without SMTP.
    transporter = {
      sendMail: async (opts) => {
        logger.info(`[MOCK EMAIL] to=${opts.to} subject="${opts.subject}"`);
        return { mocked: true };
      },
    };
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return transporter;
}

module.exports = { getTransporter };
