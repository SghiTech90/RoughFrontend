const express = require('express');
const router = express.Router();
const Session = require('../models/Session');
const Question = require('../models/Question');
const Topic = require('../models/Topic');
const { protect } = require('../middleware/auth');

// @GET /api/sessions/active?topicId=xxx  (query param)
// @GET /api/sessions/active/:topicId       (path param — same logic)
// Must be declared BEFORE /:id route to avoid conflict
async function getActiveSessionForTopic(userId, topicId) {
  const session = await Session.findOne({
    userId,
    topicId,
    status: 'active',
  })
    .populate('topicId', 'title category color')
    .sort({ createdAt: -1 });

  if (!session) return { session: null, answeredQuestionIds: [], firstUnansweredIndex: 0 };

  const Answer = require('../models/Answer');
  const answers = await Answer.find({ sessionId: session._id }).select('questionId');
  const answeredQuestionIds = answers.map(a => a.questionId.toString());

  let firstUnansweredIndex = 0;
  if (session.questions && session.questions.length > 0) {
    for (let i = 0; i < session.questions.length; i++) {
      const qId = session.questions[i]._id || session.questions[i];
      if (!answeredQuestionIds.includes(qId.toString())) {
        firstUnansweredIndex = i;
        break;
      }
    }
  }

  // Prefer lastResumeIndex saved on pause (user may have been viewing a later question)
  if (typeof session.lastResumeIndex === 'number' && session.lastResumeIndex > firstUnansweredIndex) {
    firstUnansweredIndex = session.lastResumeIndex;
  }

  return { session, answeredQuestionIds, firstUnansweredIndex };
}

router.get('/active', protect, async (req, res) => {
  try {
    const { topicId } = req.query;
    if (!topicId || topicId === 'undefined') {
      return res.status(400).json({ success: false, message: 'topicId is required' });
    }
    const data = await getActiveSessionForTopic(req.user._id, topicId);
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/sessions/active/:topicId (path param version for mobile compatibility)
router.get('/active/:topicId', protect, async (req, res) => {
  try {
    const { topicId } = req.params;
    if (!topicId || topicId === 'undefined') {
      return res.status(400).json({ success: false, message: 'topicId is required' });
    }
    const data = await getActiveSessionForTopic(req.user._id, topicId);
    res.json({ success: true, ...data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/sessions/topic/:topicId — all sessions for a specific topic
router.get('/topic/:topicId', protect, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const sessions = await Session.find({
      userId: req.user._id,
      topicId: req.params.topicId,
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, sessions });
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
    } else if (mode === 'weak_questions') {
      questions = await Question.find({
        topicId,
        userId: req.user._id,
        timesAnswered: { $gt: 0 },
        averageScore: { $lte: 7 },
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

// @PUT /api/sessions/:id/study-notes — persist revision study notes (bullet points)
router.put('/:id/study-notes', protect, async (req, res) => {
  try {
    const { studyNotes } = req.body;
    if (!Array.isArray(studyNotes)) {
      return res.status(400).json({ success: false, message: 'studyNotes must be an array' });
    }

    const sanitized = studyNotes
      .filter((n) => n && typeof n.text === 'string' && n.text.trim())
      .map((n) => ({
        id: String(n.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
        text: n.text.trim(),
        source: n.source === 'voice' ? 'voice' : 'typed',
        createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
      }));

    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { studyNotes: sanitized },
      { new: true }
    );

    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    res.json({ success: true, session, studyNotes: session.studyNotes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/sessions/:id/pause  — saves progress, keeps status: 'active' so it can be resumed
router.put('/:id/pause', protect, async (req, res) => {
  try {
    const { duration, lastResumeIndex } = req.body;

    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    // Only allow pausing active sessions
    if (session.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Only active sessions can be paused' });
    }

    const updateData = {
      duration: (session.duration || 0) + (duration || 0), // accumulate time across pauses
    };
    if (typeof lastResumeIndex === 'number') {
      updateData.lastResumeIndex = lastResumeIndex;
    }

    const updatedSession = await Session.findByIdAndUpdate(
      session._id,
      updateData,
      { new: true }
    );

    res.json({ success: true, session: updatedSession });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/sessions/:id/skip — shift skipped question to the end of the queue
router.put('/:id/skip', protect, async (req, res) => {
  try {
    const { questionId } = req.body;
    if (!questionId) {
      return res.status(400).json({ success: false, message: 'questionId is required' });
    }

    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    // Find the question in the session's questions array
    const qIndex = session.questions.findIndex(id => id.toString() === questionId.toString());
    if (qIndex === -1) {
      return res.status(400).json({ success: false, message: 'Question not found in this session' });
    }

    // Move it to the end of the questions array
    const questionsList = [...session.questions];
    const [skippedQ] = questionsList.splice(qIndex, 1);
    questionsList.push(skippedQ);

    const updatedSession = await Session.findByIdAndUpdate(
      session._id,
      { questions: questionsList },
      { new: true }
    ).populate('questions', 'questionText type difficulty expectedConcepts topicId');

    res.json({ success: true, session: updatedSession });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/sessions/:id/complete
router.put('/:id/complete', protect, async (req, res) => {
  try {
    const { duration } = req.body;
    const Answer = require('../models/Answer');
    const { generateSessionRevisionReport } = require('../services/aiService');

    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('topicId', 'title notes category');
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const avgScore = session.questionsAnswered > 0 ? session.totalScore / session.questionsAnswered : 0;

    const answers = await Answer.find({ sessionId: session._id, userId: req.user._id })
      .populate('questionId', 'questionText expectedConcepts difficulty')
      .sort({ createdAt: 1 });

    let revisionReport = null;
    if (answers.length > 0) {
      revisionReport = await generateSessionRevisionReport({
        topicTitle: session.topicId?.title || 'Mixed Topics',
        topicNotes: session.topicId?.notes || '',
        averageScore: parseFloat(avgScore.toFixed(2)),
        questionsAnswered: session.questionsAnswered,
        answers: answers.map((a) => ({
          score: a.score,
          transcript: a.transcript,
          questionText: a.questionId?.questionText || '',
          feedback: a.feedback,
        })),
      });
    }

    const updatedSession = await Session.findByIdAndUpdate(
      session._id,
      {
        status: 'completed',
        completedAt: new Date(),
        duration: duration || 0,
        averageScore: parseFloat(avgScore.toFixed(2)),
        ...(revisionReport
          ? {
              revisionReport: {
                generatedAt: new Date(),
                ...revisionReport,
              },
            }
          : {}),
      },
      { new: true }
    ).populate('topicId', 'title category color');

    // Update topic lastStudied and recalculate masteryLevel
    if (session.topicId) {
      await Topic.findByIdAndUpdate(session.topicId._id || session.topicId, { lastStudied: new Date() });

      const topicAnswers = await Answer.find({ topicId: session.topicId._id || session.topicId, userId: req.user._id });
      if (topicAnswers.length > 0) {
        const topicAvg = topicAnswers.reduce((sum, a) => sum + a.score, 0) / topicAnswers.length;
        const masteryLevel = Math.round((topicAvg / 10) * 100);
        await Topic.findByIdAndUpdate(session.topicId._id || session.topicId, { masteryLevel });
      }
    }

    // Update user streak
    await updateStreak(req.user._id);

    res.json({ success: true, session: updatedSession, revisionReport });
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

// @GET /api/sessions/:id/delete-impact — preview what will be deleted (for confirmations)
// Must be declared BEFORE /:id to avoid route conflicts
router.get('/:id/delete-impact', protect, async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const Answer = require('../models/Answer');
    const [totalAnswers, savedAnswers] = await Promise.all([
      Answer.countDocuments({ sessionId: session._id, userId: req.user._id }),
      Answer.countDocuments({ sessionId: session._id, userId: req.user._id, savedByUser: true }),
    ]);

    res.json({
      success: true,
      impact: {
        sessionId: session._id,
        totalAnswers,
        savedAnswers,
      },
    });
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
        populate: { path: 'questionId', select: 'questionText difficulty type expectedConcepts' },
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
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const [totalAnswers, savedAnswers] = await Promise.all([
      Answer.countDocuments({ sessionId: session._id, userId: req.user._id }),
      Answer.countDocuments({ sessionId: session._id, userId: req.user._id, savedByUser: true }),
    ]);

    if (!force && savedAnswers > 0) {
      return res.status(409).json({
        success: false,
        code: 'CONFIRM_DELETE_REQUIRED',
        message: `This session contains ${savedAnswers} saved answer${savedAnswers !== 1 ? 's' : ''}. Deleting it will remove them from Saved too.`,
        impact: { sessionId: session._id, totalAnswers, savedAnswers },
      });
    }

    const deleteResult = await Answer.deleteMany({ sessionId: session._id, userId: req.user._id });

    // Delete session
    await Session.findByIdAndDelete(session._id);

    res.json({
      success: true,
      message: 'Session deleted successfully',
      deleted: {
        sessionId: session._id,
        answers: deleteResult?.deletedCount ?? totalAnswers,
        savedAnswers,
      },
    });
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
