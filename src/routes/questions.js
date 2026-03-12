const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Topic = require('../models/Topic');
const { protect } = require('../middleware/auth');

// @GET /api/questions/topic/:topicId
router.get('/topic/:topicId', protect, async (req, res) => {
  try {
    if (!req.params.topicId || req.params.topicId === 'undefined') {
      return res.status(400).json({ success: false, message: 'Invalid topicId parameter' });
    }
    const { difficulty, type, limit = 10 } = req.query;
    const filter = { topicId: req.params.topicId, userId: req.user._id };

    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;

    const questions = await Question.find(filter)
      .limit(parseInt(limit))
      .sort({ nextReviewDate: 1, averageScore: 1 });

    res.json({ success: true, count: questions.length, questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/questions/topic/:topicId - Manually add a custom question
router.post('/topic/:topicId', protect, async (req, res) => {
  try {
    const { questionText, expectedConcepts, type, difficulty } = req.body;
    
    if (!questionText) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }

    const topic = await Topic.findOne({ _id: req.params.topicId, userId: req.user._id });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });

    // Parse concepts if it's a comma-separated string
    let conceptsArr = [];
    if (expectedConcepts) {
      if (Array.isArray(expectedConcepts)) {
        conceptsArr = expectedConcepts;
      } else if (typeof expectedConcepts === 'string') {
        conceptsArr = expectedConcepts.split(',').map(c => c.trim()).filter(c => c);
      }
    }

    const question = await Question.create({
      topicId: topic._id,
      userId: req.user._id,
      questionText,
      expectedConcepts: conceptsArr,
      type: type || 'concept',
      difficulty: difficulty || 'medium',
    });

    // Update topic question count
    topic.questionCount += 1;
    await topic.save();

    res.status(201).json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/questions/due - Spaced repetition: questions due for review
router.get('/due', protect, async (req, res) => {
  try {
    const questions = await Question.find({
      userId: req.user._id,
      nextReviewDate: { $lte: new Date() },
    })
      .populate('topicId', 'title category color')
      .sort({ nextReviewDate: 1 })
      .limit(20);

    res.json({ success: true, count: questions.length, questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/questions/weak - Questions with low average scores
router.get('/weak', protect, async (req, res) => {
  try {
    const questions = await Question.find({
      userId: req.user._id,
      timesAnswered: { $gt: 0 },
      averageScore: { $lt: 6 },
    })
      .populate('topicId', 'title category color')
      .sort({ averageScore: 1 })
      .limit(20);

    res.json({ success: true, count: questions.length, questions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/questions/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const question = await Question.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('topicId', 'title category');

    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
