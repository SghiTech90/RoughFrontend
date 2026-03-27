const express = require('express');
const router = express.Router();
const Answer = require('../models/Answer');
const Question = require('../models/Question');
const Session = require('../models/Session');
const Topic = require('../models/Topic');
const { protect } = require('../middleware/auth');
const { evaluateAnswer } = require('../services/aiService');

// @POST /api/answers/submit
router.post('/submit', protect, async (req, res) => {
  try {
    const { questionId, sessionId, transcript, duration = 0 } = req.body;

    if (!questionId || !transcript) {
      return res.status(400).json({ success: false, message: 'questionId and transcript are required' });
    }

    // Fetch question and topic
    const question = await Question.findById(questionId).populate('topicId');
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

    const topic = question.topicId;

    // AI Evaluation — pass notes for richer context
    const evaluation = await evaluateAnswer(
      question.questionText,
      transcript,
      question.expectedConcepts,
      topic.title,
      question.difficulty || 'medium',
      topic.notes || ''
    );

    // Create answer record
    const answer = await Answer.create({
      questionId,
      sessionId: sessionId || null,
      userId: req.user._id,
      topicId: topic._id,
      transcript,
      score: evaluation.score,
      feedback: {
        correctPoints: evaluation.correctPoints || [],
        missingConcepts: (evaluation.missingConcepts || []).slice(0, 3),
        incorrectConcepts: evaluation.incorrectConcepts || [],
        suggestions: (evaluation.suggestions || []).slice(0, 3),
        overallFeedback: evaluation.overallFeedback || '',
        interviewFeedback: evaluation.interviewFeedback || '',
        correctExplanation: evaluation.correctExplanation || '',
        keyPoints: (evaluation.keyPoints || []).slice(0, 3),
        followUpQuestion: evaluation.followUpQuestion || '',
      },
      duration,
    });

    // Update question stats
    const newTimesAnswered = question.timesAnswered + 1;
    const newAvgScore = (question.averageScore * question.timesAnswered + evaluation.score) / newTimesAnswered;

    // Spaced repetition: update interval based on score
    let { interval, easeFactor } = question;
    if (evaluation.score >= 7) {
      interval = Math.round(interval * easeFactor);
      easeFactor = Math.min(2.5, easeFactor + 0.1);
    } else if (evaluation.score >= 4) {
      interval = Math.max(1, Math.round(interval * 1.2));
    } else {
      interval = 1;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + interval);

    await Question.findByIdAndUpdate(questionId, {
      timesAnswered: newTimesAnswered,
      averageScore: parseFloat(newAvgScore.toFixed(2)),
      lastAnswered: new Date(),
      interval,
      easeFactor,
      nextReviewDate,
    });

    // Update session stats
    if (sessionId) {
      const session = await Session.findById(sessionId);
      if (session) {
        const newTotalScore = session.totalScore + evaluation.score;
        const newQuestionsAnswered = session.questionsAnswered + 1;

        await Session.findByIdAndUpdate(sessionId, {
          totalScore: newTotalScore,
          questionsAnswered: newQuestionsAnswered,
          averageScore: parseFloat((newTotalScore / newQuestionsAnswered).toFixed(2)),
          $push: { answers: answer._id },
        });
      }
    }

    // Update topic mastery level
    const topicAnswers = await Answer.find({ topicId: topic._id, userId: req.user._id });
    if (topicAnswers.length > 0) {
      const topicAvg = topicAnswers.reduce((sum, a) => sum + a.score, 0) / topicAnswers.length;
      const masteryLevel = Math.round((topicAvg / 10) * 100);
      await Topic.findByIdAndUpdate(topic._id, { masteryLevel });
    }

    res.json({
      success: true,
      answer,
      evaluation: {
        score: evaluation.score,
        correctPoints: evaluation.correctPoints || [],
        missingConcepts: (evaluation.missingConcepts || []).slice(0, 3),
        incorrectConcepts: evaluation.incorrectConcepts || [],
        suggestions: (evaluation.suggestions || []).slice(0, 3),
        overallFeedback: evaluation.overallFeedback || '',
        interviewFeedback: evaluation.interviewFeedback || '',
        correctExplanation: evaluation.correctExplanation || '',
        keyPoints: (evaluation.keyPoints || []).slice(0, 3),
        followUpQuestion: evaluation.followUpQuestion || '',
      },
    });
  } catch (error) {
    console.error('Answer submission error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/answers/history
router.get('/history', protect, async (req, res) => {
  try {
    const { topicId, limit = 20 } = req.query;
    const filter = { userId: req.user._id };
    if (topicId) filter.topicId = topicId;

    const answers = await Answer.find(filter)
      .populate('questionId', 'questionText difficulty type')
      .populate('topicId', 'title category color')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, count: answers.length, answers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/answers/saved — get all saved/liked answers for analytics
router.get('/saved', protect, async (req, res) => {
  try {
    const answers = await Answer.find({ userId: req.user._id, savedByUser: true })
      .populate('questionId', 'questionText difficulty type difficultyLevel')
      .populate('topicId', 'title category color')
      .populate('sessionId', 'completedAt createdAt mode')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: answers.length, answers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PATCH /api/answers/:id/save — toggle save/like on an answer
router.patch('/:id/save', protect, async (req, res) => {
  try {
    const answer = await Answer.findOne({ _id: req.params.id, userId: req.user._id });
    if (!answer) return res.status(404).json({ success: false, message: 'Answer not found' });

    answer.savedByUser = !answer.savedByUser;
    await answer.save();

    res.json({ success: true, savedByUser: answer.savedByUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
