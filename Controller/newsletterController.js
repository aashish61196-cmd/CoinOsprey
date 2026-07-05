const Newsletter = require("../models/Newsletter");
const { isValidEmail, required } = require("../Utils/validator");
const { sendWelcomeEmail, sendNewsletterCampaign } = require("../Services/emailService");

// POST /api/newsletter/subscribe  (public)
exports.subscribe = async (req, res, next) => {
  try {
    const missing = required(["email"], req.body);
    if (missing.length || !isValidEmail(req.body.email)) {
      return res.status(400).json({ success: false, message: "A valid email is required." });
    }

    let sub = await Newsletter.findOne({ email: req.body.email });
    if (sub && sub.status === "subscribed") {
      return res.status(200).json({ success: true, message: "You're already subscribed." });
    }

    if (sub) {
      sub.status = "subscribed";
      sub.subscribedAt = new Date();
      sub.unsubscribedAt = undefined;
      await sub.save();
    } else {
      sub = await Newsletter.create({ email: req.body.email });
    }

    sendWelcomeEmail(sub.email, sub.unsubscribeToken).catch(() => {});

    res.status(201).json({ success: true, message: "Subscribed! Check your inbox for a welcome email." });
  } catch (err) {
    next(err);
  }
};

// GET /api/newsletter/unsubscribe?token=...  (public — link from email)
exports.unsubscribe = async (req, res, next) => {
  try {
    const sub = await Newsletter.findOne({ unsubscribeToken: req.query.token });
    if (!sub) return res.status(404).json({ success: false, message: "Subscription not found." });

    sub.status = "unsubscribed";
    sub.unsubscribedAt = new Date();
    await sub.save();

    res.json({ success: true, message: "You have been unsubscribed." });
  } catch (err) {
    next(err);
  }
};

// GET /api/newsletter/admin/subscribers  (protected)
exports.listSubscribers = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const subscribers = await Newsletter.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: subscribers, count: subscribers.length });
  } catch (err) {
    next(err);
  }
};

// POST /api/newsletter/admin/campaign  (protected — send to all active subscribers)
exports.sendCampaign = async (req, res, next) => {
  try {
    const missing = required(["subject", "html"], req.body);
    if (missing.length) {
      return res.status(400).json({ success: false, message: `Missing fields: ${missing.join(", ")}` });
    }

    const subs = await Newsletter.find({ status: "subscribed" }).select("email -_id");
    const recipients = subs.map((s) => s.email);

    const results = await sendNewsletterCampaign(recipients, req.body.subject, req.body.html);
    const sentCount = results.filter((r) => r.sent).length;

    res.json({ success: true, message: `Campaign sent to ${sentCount}/${recipients.length} subscribers.`, results });
  } catch (err) {
    next(err);
  }
};
