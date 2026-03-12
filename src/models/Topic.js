const mongoose = require('mongoose');

const topicSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Topic title is required'],
      trim: true,
    },
    notes: {
      type: String,
      required: [true, 'Notes content is required'],
    },
    category: {
      type: String,
      enum: ['JavaScript', 'React', 'Node.js', 'SQL', 'MongoDB', 'CSS', 'HTML', 'System Design', 'Backend', 'Other'],
      default: 'Other',
    },
    tags: [{ type: String, trim: true }],
    color: {
      type: String,
      default: '#6C63FF',
    },
    questionsGenerated: {
      type: Boolean,
      default: false,
    },
    questionCount: {
      type: Number,
      default: 0,
    },
    lastStudied: {
      type: Date,
      default: null,
    },
    masteryLevel: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Topic', topicSchema);
