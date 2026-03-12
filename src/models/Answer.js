const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    topicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Topic',
      required: true,
    },
    transcript: {
      type: String,
      required: true,
    },
    score: {
      type: Number,
      min: 0,
      max: 10,
      required: true,
    },
    feedback: {
      correctPoints: [{ type: String }],
      missingConcepts: [{ type: String }],
      incorrectConcepts: [{ type: String }],
      suggestions: [{ type: String }],
      overallFeedback: { type: String },
      interviewFeedback: { type: String },
    },
    audioUrl: {
      type: String,
      default: null,
    },
    duration: {
      type: Number, // seconds
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Answer', answerSchema);
