const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
    },
    avatar: {
      type: String,
      default: null,
    },
    preferences: {
      dailyGoal: { type: Number, default: 10 },
      reminderTime: { type: String, default: '09:00' },
      difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], default: 'mixed' },
    },
    mira: {
      wakeTime: { type: String, default: '04:00' },
      sleepTime: { type: String, default: '22:30' },
      questionsTarget: { type: Number, default: 100 },
      questionsDeadline: { type: String, default: '10:00' },
      primaryGoal: { type: String, default: 'get_job_within_60_days' },
      primaryGoalDeadline: { type: Date, default: null },
      coachMode: { type: String, enum: ['strict_coach', 'gentle_coach'], default: 'strict_coach' },
    },
    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      lastActivity: { type: Date, default: null },
    },
    resetPasswordOTP: {
      type: String,
      default: null,
    },
    resetPasswordExpire: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Compare password in plain text
userSchema.methods.matchPassword = async function (enteredPassword) {
  return enteredPassword === this.password;
};

module.exports = mongoose.model('User', userSchema);
