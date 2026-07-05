const mongoose = require('mongoose');

// ---- Primitive validators ----

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^\S+@\S+\.\S+$/.test(email.trim());
}

function isStrongPassword(password, minLength = 6) {
  return typeof password === 'string' && password.length >= minLength;
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function isValidUrl(url) {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isNonEmptyString(value, maxLength = null) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  if (maxLength && value.length > maxLength) return false;
  return true;
}

// ---- Domain-specific validators ----

const VALID_MARKET_TYPES = ['crypto', 'indian_stock', 'general_finance', 'mixed'];
const VALID_ARTICLE_FORMATS = [
  'analyst_verdict', 'story_led_narrative', 'breakout_alert', 'price_prediction',
  'news_analysis', 'technical_deep_dive', 'market_roundup', 'opinion_editorial',
];
const VALID_ARTICLE_STATUSES = ['draft', 'scheduled', 'published', 'archived'];
const VALID_USER_ROLES = ['user', 'editor', 'admin'];
const VALID_LANGUAGES = ['en', 'hi'];

function isValidMarketType(value) {
  return VALID_MARKET_TYPES.includes(value);
}

function isValidArticleFormat(value) {
  return VALID_ARTICLE_FORMATS.includes(value);
}

function isValidArticleStatus(value) {
  return VALID_ARTICLE_STATUSES.includes(value);
}

function isValidUserRole(value) {
  return VALID_USER_ROLES.includes(value);
}

function isValidLanguage(value) {
  return VALID_LANGUAGES.includes(value);
}

/**
 * Validate a full article payload (used before create/update).
 * Returns { valid: boolean, errors: string[] }.
 */
function validateArticlePayload(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.title !== undefined) {
    if (!isNonEmptyString(body.title, 180)) {
      errors.push('Title is required and must be under 180 characters');
    }
  }

  if (!partial || body.content !== undefined) {
    if (!isNonEmptyString(body.content)) {
      errors.push('Content is required');
    }
  }

  if (!partial || body.category !== undefined) {
    if (!body.category || !isValidObjectId(body.category)) {
      errors.push('A valid category id is required');
    }
  }

  if (body.marketType !== undefined && !isValidMarketType(body.marketType)) {
    errors.push(`marketType must be one of: ${VALID_MARKET_TYPES.join(', ')}`);
  }

  if (body.articleFormat !== undefined && !isValidArticleFormat(body.articleFormat)) {
    errors.push(`articleFormat must be one of: ${VALID_ARTICLE_FORMATS.join(', ')}`);
  }

  if (body.status !== undefined && !isValidArticleStatus(body.status)) {
    errors.push(`status must be one of: ${VALID_ARTICLE_STATUSES.join(', ')}`);
  }

  if (body.language !== undefined && !isValidLanguage(body.language)) {
    errors.push(`language must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }

  if (body.seo?.metaTitle && body.seo.metaTitle.length > 70) {
    errors.push('seo.metaTitle should be under 70 characters');
  }

  if (body.seo?.metaDescription && body.seo.metaDescription.length > 160) {
    errors.push('seo.metaDescription should be under 160 characters');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a registration payload.
 */
function validateRegisterPayload(body) {
  const errors = [];

  if (!isNonEmptyString(body.name, 80)) {
    errors.push('Name is required and must be under 80 characters');
  }
  if (!isValidEmail(body.email)) {
    errors.push('A valid email address is required');
  }
  if (!isStrongPassword(body.password)) {
    errors.push('Password must be at least 6 characters');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Express middleware factory: runs a validator function against req.body
 * and returns a 400 with error details if invalid, otherwise calls next().
 */
function validateBody(validatorFn, options = {}) {
  return (req, res, next) => {
    const { valid, errors } = validatorFn(req.body, options);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }
    next();
  };
}

module.exports = {
  isValidEmail,
  isStrongPassword,
  isValidObjectId,
  isValidUrl,
  isNonEmptyString,
  isValidMarketType,
  isValidArticleFormat,
  isValidArticleStatus,
  isValidUserRole,
  isValidLanguage,
  validateArticlePayload,
  validateRegisterPayload,
  validateBody,
};
