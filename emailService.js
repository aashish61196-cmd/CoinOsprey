const { getTransporter } = require("../config/mail");

const FROM = process.env.MAIL_FROM || '"CoinOsprey" <no-reply@coinosprey.com>';

async function sendMail({ to, subject, html, text }) {
  const transporter = getTransporter();
  return transporter.sendMail({ from: FROM, to, subject, html, text });
}

function wrapTemplate(title, bodyHtml) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;background:#06090D;padding:32px;color:#F3F5F7;">
    <div style="max-width:520px;margin:0 auto;background:#0d1218;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;">
      <h2 style="color:#E3A73B;margin:0 0 16px;">${title}</h2>
      <div style="color:#A7B0BC;line-height:1.6;">${bodyHtml}</div>
      <p style="margin-top:32px;font-size:12px;color:#6E7885;">CoinOsprey — crypto news &amp; market research</p>
    </div>
  </div>`;
}

async function sendWelcomeEmail(email, unsubscribeToken) {
  const unsubUrl = `${process.env.CLIENT_URL || ""}/unsubscribe?token=${unsubscribeToken}`;
  const html = wrapTemplate(
    "Welcome to CoinOsprey 👋",
    `<p>You're subscribed to the CoinOsprey newsletter — market recaps, breaking news and price alerts, straight to your inbox.</p>
     <p style="font-size:12px;">Didn't sign up? <a style="color:#2DD4BF" href="${unsubUrl}">Unsubscribe here</a>.</p>`
  );
  return sendMail({ to: email, subject: "Welcome to CoinOsprey", html });
}

async function sendCommentApprovedEmail(email, articleTitle, articleUrl) {
  const html = wrapTemplate(
    "Your comment was approved",
    `<p>Your comment on <b>${articleTitle}</b> is now live.</p>
     <p><a style="color:#2DD4BF" href="${articleUrl}">View it on CoinOsprey</a></p>`
  );
  return sendMail({ to: email, subject: "Your comment was approved", html });
}

async function sendNewsletterCampaign(recipients, subject, contentHtml) {
  // Sends sequentially to keep this simple/dependency-free. For large lists,
  // swap this for a batch provider (SendGrid/Mailgun/SES) instead of SMTP.
  const results = [];
  for (const email of recipients) {
    try {
      await sendMail({ to: email, subject, html: wrapTemplate(subject, contentHtml) });
      results.push({ email, sent: true });
    } catch (err) {
      results.push({ email, sent: false, error: err.message });
    }
  }
  return results;
}

module.exports = {
  sendMail,
  sendWelcomeEmail,
  sendCommentApprovedEmail,
  sendNewsletterCampaign,
};
