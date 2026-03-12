const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
  {
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    questionText: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['concept', 'explanation', 'scenario', 'practical'],
      default: 'concept',
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    expectedConcepts: [{ type: String }],
    timesAnswered: {
      type: Number,
      default: 0,
    },
    averageScore: {
      type: Number,
      default: 0,
    },
    lastAnswered: {
      type: Date,
      default: null,
    },
    // Spaced repetition
    nextReviewDate: {
      type: Date,
      default: Date.now,
    },
    interval: {
      type: Number,
      default: 1,
    },
    easeFactor: {
      type: Number,
      default: 2.5,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Question', questionSchema);
