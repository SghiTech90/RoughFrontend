const mongoose = require('mongoose');

/**
 * DisciplineScore — stores one daily CR7 discipline score per user.
 * Pushed from Personal OS after each day ends.
 */
const DisciplineScoreSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    date: {
        type: String,        // "YYYY-MM-DD"
        required: true
    },
    score: {
        type: Number,        // 0–100
        required: true,
        min: 0,
        max: 100
    },
    level: {
        type: Number,
        default: 0
    },
    isPerfectDay: {
        type: Boolean,
        default: false
    },
    isSeriousDrop: {
        type: Boolean,
        default: false
    },
    perfectDayStreak: {
        type: Number,
        default: 0
    },
    // Per-habit breakdown: { meditation: { actual: 15, target: 20 }, ... }
    habitBreakdown: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    // Human-readable summary from DisciplineScoreEngine
    summaryLine: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// One score per user per date
DisciplineScoreSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DisciplineScore', DisciplineScoreSchema);
