const crypto = require('crypto');
const Newsletter = require('../models/Newsletter');
const { sendNewsletterConfirmation, sendCampaignEmail } = require('../services/emailService');
const logger = require('../utils/logger');

// @desc    Subscribe to the newsletter (starts double opt-in flow)
// @route   POST /api/newsletter/subscribe
// @access  Public
exports.subscribe = async (req, res, next) => {
  try {
    const { email, name, interests, frequency, language, source } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    let subscriber = await Newsletter.findOne({ email: email.toLowerCase() });

    if (subscriber && subscriber.status === 'subscribed') {
      return res.status(200).json({
        success: true,
        message: 'You are already subscribed to our newsletter',
      });
    }

    if (!subscriber) {
      subscriber = new Newsletter({
        email,
        name,
        interests,
        frequency,
        language,
        source: source || 'website',
        ipAddress: req.ip,
      });
    } else {
      // Re-subscribing after a previous unsubscribe; refresh preferences
      subscriber.name = name || subscriber.name;
      subscriber.interests = interests || subscriber.interests;
      subscriber.frequency = frequency || subscriber.frequency;
      subscriber.language = language || subscriber.language;
      subscriber.status = 'pending';
    }

    const confirmationToken = subscriber.generateConfirmationToken();
    subscriber.generateUnsubscribeToken();
    await subscriber.save();

    try {
      await sendNewsletterConfirmation(subscriber.email, subscriber.name, confirmationToken);
    } catch (emailErr) {
      logger.logError(emailErr, 'newsletterController.subscribe - sendNewsletterConfirmation');
    }

    res.status(201).json({
      success: true,
      message: 'Please check your email to confirm your subscription',
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'This email is already registered' });
    }
    next(err);
  }
};

// @desc    Confirm a newsletter subscription (double opt-in)
// @route   GET /api/newsletter/confirm/:token
// @access  Public
exports.confirmSubscription = async (req, res, next) => {
  try {
    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const subscriber = await Newsletter.findOne({
      confirmationToken: hashedToken,
      confirmationTokenExpires: { $gt: Date.now() },
    }).select('+confirmationToken +confirmationTokenExpires');

    if (!subscriber) {
      return res.status(400).json({
        success: false,
        message: 'Confirmation link is invalid or has expired',
      });
    }

    await subscriber.confirmSubscription();

    res.status(200).json({
      success: true,
      message: 'Subscription confirmed! You are now on our newsletter list.',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Unsubscribe using a one-click token from an email footer
// @route   GET /api/newsletter/unsubscribe/:token
// @access  Public
exports.unsubscribe = async (req, res, next) => {
  try {
    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const subscriber = await Newsletter.findOne({
      unsubscribeToken: hashedToken,
    }).select('+unsubscribeToken');

    if (!subscriber) {
      return res.status(400).json({ success: false, message: 'Invalid unsubscribe link' });
    }

    await subscriber.unsubscribe(req.query.reason || '');

    res.status(200).json({ success: true, message: 'You have been unsubscribed successfully' });
  } catch (err) {
    next(err);
  }
};

// @desc    Update subscriber preferences (interests, frequency, language)
// @route   PUT /api/newsletter/preferences/:token
// @access  Public (token-authenticated, no login required)
exports.updatePreferences = async (req, res, next) => {
  try {
    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const subscriber = await Newsletter.findOne({ unsubscribeToken: hashedToken }).select(
      '+unsubscribeToken'
    );

    if (!subscriber) {
      return res.status(400).json({ success: false, message: 'Invalid preferences link' });
    }

    const { interests, frequency, language } = req.body;
    if (interests) subscriber.interests = interests;
    if (frequency) subscriber.frequency = frequency;
    if (language) subscriber.language = language;

    await subscriber.save();

    res.status(200).json({ success: true, message: 'Preferences updated successfully' });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all subscribers with pagination and filters
// @route   GET /api/newsletter/subscribers
// @access  Private (admin)
exports.getSubscribers = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, status, interest } = req.query;
    const query = {};

    if (status) query.status = status;
    if (interest) query.interests = interest;

    const skip = (Number(page) - 1) * Number(limit);
    const [subscribers, total] = await Promise.all([
      Newsletter.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Newsletter.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: subscribers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Send a campaign email to filtered active subscribers
// @route   POST /api/newsletter/send-campaign
// @access  Private (admin)
exports.sendCampaign = async (req, res, next) => {
  try {
    const { subject, htmlContent, interests, language } = req.body;

    if (!subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        message: 'Subject and HTML content are required',
      });
    }

    const filters = {};
    if (interests && interests.length) filters.interests = { $in: interests };
    if (language) filters.language = language;

    const subscribers = await Newsletter.getActiveSubscribers(filters);

    if (subscribers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active subscribers match the given filters',
      });
    }

    // Send in the background so the request doesn't block on hundreds/thousands of emails
    res.status(202).json({
      success: true,
      message: `Campaign queued for ${subscribers.length} subscriber(s)`,
    });

    for (const subscriber of subscribers) {
      try {
        await sendCampaignEmail(subscriber.email, subject, htmlContent, subscriber.unsubscribeToken);
        subscriber.lastEmailSentAt = new Date();
        subscriber.emailsSentCount += 1;
        await subscriber.save({ validateBeforeSave: false });
      } catch (emailErr) {
        subscriber.bounceCount += 1;
        await subscriber.save({ validateBeforeSave: false });
        logger.logError(emailErr, `sendCampaign - ${subscriber.email}`);
      }
    }
  } catch (err) {
    next(err);
  }
};
