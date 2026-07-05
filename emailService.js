const transporter = require('../config/mail');
const logger = require('../utils/logger');

const APP_NAME = process.env.APP_NAME || 'AVFINANCEHUB';
const CLIENT_URL = process.env.CLIENT_URL || 'https://avfinancehub.com';
const FROM_ADDRESS = process.env.MAIL_FROM || `"${APP_NAME}" <no-reply@avfinancehub.com>`;

// ---- Shared wrapper: send + log, throw on failure so callers can handle it ----
async function send(mailOptions) {
  try {
    const info = await transporter.sendMail({ from: FROM_ADDRESS, ...mailOptions });
    logger.info(`Email sent: ${mailOptions.subject} -> ${mailOptions.to}`);
    return info;
  } catch (err) {
    logger.logError(err, `emailService.send - ${mailOptions.to}`);
    throw err;
  }
}

// ---- Basic shared email wrapper template ----
function wrapTemplate(bodyHtml) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #0f172a; padding: 20px; text-align: center;">
        <h1 style="color: #14b8a6; margin: 0; font-size: 22px;">${APP_NAME}</h1>
      </div>
      <div style="padding: 24px; background: #ffffff;">
        ${bodyHtml}
      </div>
      <div style="padding: 16px; text-align: center; font-size: 12px; color: #888;">
        &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  `;
}

/**
 * Send account email verification link after registration.
 */
async function sendVerificationEmail(to, name, token) {
  const verifyUrl = `${CLIENT_URL}/verify-email/${token}`;
  const html = wrapTemplate(`
    <h2>Hi ${name},</h2>
    <p>Thanks for signing up for ${APP_NAME}. Please verify your email address to activate your account.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${verifyUrl}" style="background:#14b8a6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Verify Email</a>
    </p>
    <p>This link expires in 24 hours. If you didn't create this account, you can safely ignore this email.</p>
  `);

  return send({ to, subject: `Verify your ${APP_NAME} account`, html });
}

/**
 * Send password reset link.
 */
async function sendPasswordResetEmail(to, name, token) {
  const resetUrl = `${CLIENT_URL}/reset-password/${token}`;
  const html = wrapTemplate(`
    <h2>Hi ${name},</h2>
    <p>We received a request to reset your password. Click below to choose a new one.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" style="background:#14b8a6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Reset Password</a>
    </p>
    <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `);

  return send({ to, subject: `Reset your ${APP_NAME} password`, html });
}

/**
 * Send newsletter double opt-in confirmation.
 */
async function sendNewsletterConfirmation(to, name, token) {
  const confirmUrl = `${CLIENT_URL}/newsletter/confirm/${token}`;
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const html = wrapTemplate(`
    <h2>${greeting}</h2>
    <p>Please confirm your subscription to the ${APP_NAME} newsletter for the latest crypto and market insights.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${confirmUrl}" style="background:#14b8a6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Confirm Subscription</a>
    </p>
    <p>This link expires in 48 hours. If you didn't request this, you can safely ignore this email.</p>
  `);

  return send({ to, subject: `Confirm your ${APP_NAME} newsletter subscription`, html });
}

/**
 * Send a marketing/campaign email to a newsletter subscriber, with an
 * unsubscribe link built from their personal unsubscribe token.
 */
async function sendCampaignEmail(to, subject, htmlContent, unsubscribeToken) {
  const unsubscribeUrl = `${CLIENT_URL}/api/newsletter/unsubscribe/${unsubscribeToken}`;
  const html = wrapTemplate(`
    ${htmlContent}
    <p style="text-align: center; margin-top: 32px; font-size: 12px; color: #888;">
      <a href="${unsubscribeUrl}" style="color: #888;">Unsubscribe from these emails</a>
    </p>
  `);

  return send({ to, subject, html });
}

/**
 * Send a notification to admins (e.g. new comment pending moderation).
 */
async function sendAdminNotification(to, subject, message) {
  const html = wrapTemplate(`<h2>${subject}</h2><p>${message}</p>`);
  return send({ to, subject: `[${APP_NAME} Admin] ${subject}`, html });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNewsletterConfirmation,
  sendCampaignEmail,
  sendAdminNotification,
};
