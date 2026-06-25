const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const DisciplineScore = require('../models/DisciplineScore');

/**
 * POST /api/personalos/daily-score
 * Personal OS pushes today's discipline score after the day ends.
 * Body: { date, score, level, isPerfectDay, isSeriousDrop,
 *         perfectDayStreak, habitBreakdown, summaryLine }
 */
router.post('/daily-score', protect, async (req, res) => {
    try {
        const {
            date, score, level, isPerfectDay, isSeriousDrop,
            perfectDayStreak, habitBreakdown, summaryLine
        } = req.body;

        if (!date || score === undefined) {
            return res.status(400).json({ success: false, message: 'date and score are required' });
        }

        // Upsert: one record per user per date
        const record = await DisciplineScore.findOneAndUpdate(
            { userId: req.user.id, date },
            {
                userId: req.user.id,
                date, score, level: level || 0,
                isPerfectDay: !!isPerfectDay,
                isSeriousDrop: !!isSeriousDrop,
                perfectDayStreak: perfectDayStreak || 0,
                habitBreakdown: habitBreakdown || {},
                summaryLine: summaryLine || ''
            },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ success: true, data: record });
    } catch (err) {
        console.error('personalos/daily-score error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/personalos/analytics?days=30
 * Returns last N days of discipline scores for the authenticated user.
 * Response: { success, data: [ { date, score, level, isPerfectDay, isSeriousDrop, habitBreakdown } ] }
 */
router.get('/analytics', protect, async (req, res) => {
    try {
        const days = Math.min(parseInt(req.query.days) || 30, 365);

        // Compute start date string
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startStr = startDate.toISOString().split('T')[0]; // "YYYY-MM-DD"

        const scores = await DisciplineScore.find({
            userId: req.user.id,
            date: { $gte: startStr }
        })
        .sort({ date: 1 })
        .select('date score level isPerfectDay isSeriousDrop perfectDayStreak habitBreakdown summaryLine -_id')
        .lean();

        // Summary stats
        const totalDays = scores.length;
        const avgScore = totalDays > 0
            ? Math.round(scores.reduce((s, d) => s + d.score, 0) / totalDays)
            : 0;
        const perfectDays = scores.filter(d => d.isPerfectDay).length;
        const bestScore = totalDays > 0 ? Math.max(...scores.map(d => d.score)) : 0;
        const longestStreak = computeLongestStreak(scores);

        res.json({
            success: true,
            data: scores,
            summary: { totalDays, avgScore, perfectDays, bestScore, longestStreak }
        });
    } catch (err) {
        console.error('personalos/analytics error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/personalos/streak
 * Returns current perfect-day streak and best streak for the user.
 */
router.get('/streak', protect, async (req, res) => {
    try {
        const scores = await DisciplineScore.find({ userId: req.user.id })
            .sort({ date: -1 })
            .limit(100)
            .select('date score isPerfectDay -_id')
            .lean();

        let currentStreak = 0;
        for (const s of scores) {
            if (s.isPerfectDay) currentStreak++;
            else break;
        }

        const bestStreak = computeLongestStreak([...scores].reverse());

        res.json({ success: true, currentStreak, bestStreak });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── helpers ──────────────────────────────────────────────────────────────────

function computeLongestStreak(scores) {
    let best = 0, cur = 0;
    for (const s of scores) {
        if (s.isPerfectDay) { cur++; best = Math.max(best, cur); }
        else cur = 0;
    }
    return best;
}

module.exports = router;
