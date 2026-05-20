const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, protect } = require('../middleware/auth');

// @POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide all fields' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    const user = await User.create({ name, email, password });
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, preferences: user.preferences, streak: user.streak },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email, preferences: user.preferences, streak: user.streak },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// @PUT /api/auth/preferences
router.put('/preferences', protect, async (req, res) => {
  try {
    const { dailyGoal, reminderTime, difficulty } = req.body;
    const update = {};
    if (dailyGoal !== undefined) update['preferences.dailyGoal'] = dailyGoal;
    if (reminderTime !== undefined) update['preferences.reminderTime'] = reminderTime;
    if (difficulty !== undefined) update['preferences.difficulty'] = difficulty;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: update },
      { new: true }
    ).select('-password');

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const nodemailer = require('nodemailer');

// Helper: create transporter (lazy so missing env vars don't crash on import)
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// @POST /api/auth/forgot-password — sends a 6-digit OTP to the user's email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    // Always respond with success to avoid email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If that email exists, an OTP has been sent.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expire = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Hash OTP before storing
    const bcrypt = require('bcryptjs');
    const hashedOtp = await bcrypt.hash(otp, 10);

    user.resetPasswordOTP = hashedOtp;
    user.resetPasswordExpire = expire;
    await user.save({ validateBeforeSave: false });

    // Send email
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Revision AI" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Your Password Reset OTP',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0F1123;border-radius:16px;color:#fff">
          <h2 style="color:#6366F1;margin-bottom:8px">🔑 Password Reset</h2>
          <p style="color:#94A3B8">Use the OTP below to reset your Revision AI password. It expires in <strong>10 minutes</strong>.</p>
          <div style="background:#1E2139;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#6366F1">${otp}</span>
          </div>
          <p style="color:#64748B;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true, message: 'OTP sent to your email address.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    // Surface a more actionable message for common SMTP auth failures
    const isAuthError = error.code === 'EAUTH' || error.responseCode === 535;
    const clientMsg = isAuthError
      ? 'Email service authentication failed. Please contact support.'
      : 'Failed to send OTP. Please try again.';
    res.status(500).json({ success: false, message: clientMsg });
  }
});

// @POST /api/auth/verify-otp — checks OTP validity without resetting password
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required' });

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.resetPasswordOTP || !user.resetPasswordExpire) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please request a new one.' });
    }

    if (user.resetPasswordExpire < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(otp.trim(), user.resetPasswordOTP);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
    }

    res.json({ success: true, message: 'OTP verified successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/auth/reset-password — verifies OTP + sets new password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, OTP and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !user.resetPasswordOTP || !user.resetPasswordExpire) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Please request a new one.' });
    }

    if (user.resetPasswordExpire < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(otp.trim(), user.resetPasswordOTP);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
    }

    // Set new password (pre-save hook will hash it)
    user.password = newPassword;
    user.resetPasswordOTP = null;
    user.resetPasswordExpire = null;
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
