const crypto = require('crypto');
const User = require('../models/User');
const { generateToken, generateRefreshToken } = require('../utils/generateToken');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const logger = require('../utils/logger');

// ---- Cookie options for refresh token ----
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are all required',
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    const user = new User({ name, email, password });
    const verificationToken = user.generateVerificationToken();
    await user.save();

    try {
      await sendVerificationEmail(user.email, user.name, verificationToken);
    } catch (emailErr) {
      logger.logError(emailErr, 'authController.register - sendVerificationEmail');
      // Don't fail registration if email fails to send; user can request resend
    }

    logger.info(`New user registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      data: user.toSafeObject(),
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Verify email address
// @route   GET /api/auth/verify-email/:token
// @access  Public
exports.verifyEmail = async (req, res, next) => {
  try {
    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpires: { $gt: Date.now() },
    }).select('+verificationToken +verificationTokenExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Verification link is invalid or has expired',
      });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Email verified successfully. You can now log in.',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Log in a user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated. Contact support for help.',
      });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const accessToken = generateToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toSafeObject(),
        accessToken,
      },
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Log out current user (clears refresh token cookie)
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  try {
    res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

// @desc    Get currently logged-in user's profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

// @desc    Request a password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });

    // Always return a generic success message, even if user doesn't exist,
    // to avoid leaking which emails are registered.
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists for this email, a reset link has been sent.',
      });
    }

    const resetToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    try {
      await sendPasswordResetEmail(user.email, user.name, resetToken);
    } catch (emailErr) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });
      logger.logError(emailErr, 'authController.forgotPassword - sendPasswordResetEmail');
      return res.status(500).json({
        success: false,
        message: 'Could not send reset email. Please try again later.',
      });
    }

    res.status(200).json({
      success: true,
      message: 'If an account exists for this email, a reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Reset password using token from email
// @route   POST /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Reset link is invalid or has expired',
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Issue a new access token using the refresh token cookie
// @route   POST /api/auth/refresh
// @access  Public (requires valid refresh token cookie)
exports.refreshAccessToken = async (req, res, next) => {
  try {
    const { verifyRefreshToken } = require('../config/jwt');
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({ success: false, message: 'No refresh token provided' });
    }

    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const accessToken = generateToken(user._id, user.role);
    res.status(200).json({ success: true, data: { accessToken } });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};
