const mongoose = require('mongoose');

const miraMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['life', 'person', 'goal', 'mood', 'preference', 'spiritual', 'other'],
      default: 'life',
    },
    content: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true }],
    source: { type: String, enum: ['voice', 'text', 'system'], default: 'voice' },
  },
  { timestamps: true }
);

miraMemorySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('MiraMemory', miraMemorySchema);
