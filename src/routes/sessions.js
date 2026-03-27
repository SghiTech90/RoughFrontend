const express = require('express');
const router = express.Router();
const Session = require('../models/Session');
const Question = require('../models/Question');
const Topic = require('../models/Topic');
const { protect } = require('../middleware/auth');

// @GET /api/sessions/active?topicId=xxx
// Must be declared BEFORE /:id route to avoid conflict
router.get('/active', protect, async (req, res) => {
  try {
    const { topicId } = req.query;
    if (!topicId || topicId === 'undefined') {
      return res.status(400).json({ success: false, message: 'topicId is required' });
    }

    const session = await Session.findOne({
      userId: req.user._id,
      topicId,
      status: 'active',
    })
      .populate('topicId', 'title category color')
      .sort({ createdAt: -1 });

    if (!session) {
      return res.json({ success: true, session: null });
    }

    // Get the question IDs already answered in this session
    const Answer = require('../models/Answer');
    const answers = await Answer.find({ sessionId: session._id }).select('questionId');
    const answeredQuestionIds = answers.map(a => a.questionId.toString());

    // Find the first index that hasn't been answered
    let firstUnansweredIndex = 0;
    if (session.questions && session.questions.length > 0) {
      for (let i = 0; i < session.questions.length; i++) {
        const qId = session.questions[i]._id || session.questions[i];
        if (!answeredQuestionIds.includes(qId.toString())) {
          firstUnansweredIndex = i;
          break;
        }
        // If all answered, it will stay at the last index or handle complete state
      }
    }

    res.json({
      success: true,
      session,
      answeredQuestionIds,
      firstUnansweredIndex,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/sessions/start
router.post('/start', protect, async (req, res) => {
  try {
    const { topicId, mode = 'revision', questionCount = 5 } = req.body;

    let questions = [];

    if (mode === 'weak_topics') {
      questions = await Question.find({
        userId: req.user._id,
        timesAnswered: { $gt: 0 },
        averageScore: { $lt: 6 },
      })
        .limit(questionCount)
        .populate('topicId', 'title category');
    } else if (mode === 'spaced_repetition') {
      questions = await Question.find({
        userId: req.user._id,
        nextReviewDate: { $lte: new Date() },
      })
        .limit(questionCount)
        .populate('topicId', 'title category');
    } else if (topicId) {
      questions = await Question.find({
        topicId,
        userId: req.user._id,
      })
        .limit(questionCount)
        .sort({ nextReviewDate: 1 })
        .populate('topicId', 'title category');
    } else {
      // Mixed mode: pick from all topics
      questions = await Question.find({ userId: req.user._id })
        .limit(questionCount)
        .sort({ nextReviewDate: 1 })
        .populate('topicId', 'title category');
    }

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No questions available. Please add topics and wait for questions to be generated.',
      });
    }

    const session = await Session.create({
      userId: req.user._id,
      topicId: topicId || null,
      mode,
      totalQuestions: questions.length,
      startedAt: new Date(),
      questions: questions.map(q => q._id)
    });

    res.json({
      success: true,
      session,
      questions: questions.map((q) => ({
        _id: q._id,
        questionText: q.questionText,
        type: q.type,
        difficulty: q.difficulty,
        expectedConcepts: q.expectedConcepts,
        topic: q.topicId,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/sessions/:id/complete
router.put('/:id/complete', protect, async (req, res) => {
  try {
    const { duration } = req.body;

    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const avgScore = session.questionsAnswered > 0 ? session.totalScore / session.questionsAnswered : 0;

    const updatedSession = await Session.findByIdAndUpdate(
      session._id,
      {
        status: 'completed',
        completedAt: new Date(),
        duration: duration || 0,
        averageScore: parseFloat(avgScore.toFixed(2)),
      },
      { new: true }
    );

    // Update topic lastStudied and recalculate masteryLevel
    if (session.topicId) {
      await Topic.findByIdAndUpdate(session.topicId, { lastStudied: new Date() });

      // Recalculate mastery from all answers for this topic to keep it in sync
      const Answer = require('../models/Answer');
      const topicAnswers = await Answer.find({ topicId: session.topicId, userId: req.user._id });
      if (topicAnswers.length > 0) {
        const topicAvg = topicAnswers.reduce((sum, a) => sum + a.score, 0) / topicAnswers.length;
        const masteryLevel = Math.round((topicAvg / 10) * 100);
        await Topic.findByIdAndUpdate(session.topicId, { masteryLevel });
      }
    }

    // Update user streak
    await updateStreak(req.user._id);

    res.json({ success: true, session: updatedSession });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/sessions/history/by-date — sessions grouped by date for revision history
// Must be declared BEFORE /:id to avoid route conflicts
router.get('/history/by-date', protect, async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user._id, status: 'completed' })
      .populate('topicId', 'title category color')
      .sort({ completedAt: -1, createdAt: -1 })
      .limit(200);

    // Group sessions by date string
    const grouped = {};
    for (const s of sessions) {
      const d = new Date(s.completedAt || s.createdAt);
      const key = d.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s);
    }

    // Convert to sorted array of { date, sessions }
    const result = Object.entries(grouped)
      .map(([date, sessions]) => ({ date, sessions }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    res.json({ success: true, history: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/sessions
router.get('/', protect, async (req, res) => {
  try {
    const { limit = 10, page = 1, topicId, status } = req.query;
    const skip = (page - 1) * limit;

    const filter = { userId: req.user._id };
    if (topicId) filter.topicId = topicId;
    if (status) filter.status = status;

    const sessions = await Session.find(filter)
      .populate('topicId', 'title category color')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Session.countDocuments(filter);

    res.json({ success: true, sessions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/sessions/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('topicId', 'title category color')
      .populate('questions', 'questionText type difficulty expectedConcepts topicId')
      .populate({
        path: 'answers',
        populate: { path: 'questionId', select: 'questionText difficulty type' },
      });

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/sessions/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    // Delete associated answers
    const Answer = require('../models/Answer');
    await Answer.deleteMany({ sessionId: session._id });

    // Delete session
    await Session.findByIdAndDelete(session._id);

    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

async function updateStreak(userId) {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId);
    const now = new Date();
    const lastActivity = user.streak.lastActivity;

    if (lastActivity) {
      const daysDiff = Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        user.streak.current += 1;
        if (user.streak.current > user.streak.longest) {
          user.streak.longest = user.streak.current;
        }
      } else if (daysDiff > 1) {
        user.streak.current = 1;
      }
    } else {
      user.streak.current = 1;
      user.streak.longest = 1;
    }

    user.streak.lastActivity = now;
    await user.save();
  } catch (err) {
    console.error('Streak update error:', err.message);
  }
}

module.exports = router;
