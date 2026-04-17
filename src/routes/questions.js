const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Topic = require('../models/Topic');
const { protect } = require('../middleware/auth');
const { generateQuestions } = require('../services/aiService');

const MAX_QUESTIONS_PER_TOPIC = 200;

// @GET /api/questions/topic/:topicId
router.get('/topic/:topicId', protect, async (req, res) => {
  try {
    if (!req.params.topicId || req.params.topicId === 'undefined') {
      return res.status(400).json({ success: false, message: 'Invalid topicId parameter' });
    }
    const { difficulty, type, source, limit = 50 } = req.query;
    const filter = { topicId: req.params.topicId, userId: req.user._id };

    if (difficulty) filter.difficulty = difficulty;
    if (type) filter.type = type;
    if (source) filter.source = source;

    const questions = await Question.find(filter)
      .limit(parseInt(limit))
      .sort({ difficultyLevel: 1, nextReviewDate: 1, averageScore: 1 });

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

    const existingCount = await Question.countDocuments({ topicId: topic._id, userId: req.user._id });
    if (existingCount >= MAX_QUESTIONS_PER_TOPIC) {
      return res.status(400).json({
        success: false,
        code: 'TOPIC_QUESTION_LIMIT_REACHED',
        message: `You can add up to ${MAX_QUESTIONS_PER_TOPIC} questions per topic.`,
        limit: MAX_QUESTIONS_PER_TOPIC,
        current: existingCount,
      });
    }

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

    // Update topic question count (keep it strictly in sync)
    const totalCount = await Question.countDocuments({ topicId: topic._id, userId: req.user._id });
    await Topic.findByIdAndUpdate(topic._id, { questionCount: totalCount });

    res.status(201).json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/questions/topic/:topicId/generate - Generate 5 AI questions (5-level difficulty)
router.post('/topic/:topicId/generate', protect, async (req, res) => {
  try {
    const topic = await Topic.findOne({ _id: req.params.topicId, userId: req.user._id });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });

    const existingCount = await Question.countDocuments({ topicId: topic._id, userId: req.user._id });
    const remaining = Math.max(0, MAX_QUESTIONS_PER_TOPIC - existingCount);
    if (remaining === 0) {
      return res.status(400).json({
        success: false,
        code: 'TOPIC_QUESTION_LIMIT_REACHED',
        message: `This topic already has ${MAX_QUESTIONS_PER_TOPIC} questions. Delete some questions to generate more.`,
        limit: MAX_QUESTIONS_PER_TOPIC,
        current: existingCount,
      });
    }

    // Generate 5 levelled questions from AI
    const aiQuestions = await generateQuestions(topic.title, topic.notes, topic.category);

    if (!aiQuestions || aiQuestions.length === 0) {
      return res.status(500).json({ success: false, message: 'AI failed to generate questions. Please try again.' });
    }

    // Map with fallbacks and tag as AI-generated
    const questionDocs = aiQuestions.map((q) => ({
      topicId: topic._id,
      userId: req.user._id,
      questionText: q.questionText || q.question || q.text || 'Missing question text',
      type: q.type || 'concept',
      difficulty: q.difficulty || 'medium',
      difficultyLevel: q.difficultyLevel || null,
      expectedConcepts: q.expectedConcepts || q.concepts || [],
      source: 'ai',
    }));

    const validDocs = questionDocs.filter(q => q.questionText !== 'Missing question text');

    if (validDocs.length === 0) {
      return res.status(500).json({ success: false, message: 'AI returned no valid questions.' });
    }

    const docsToInsert = validDocs.slice(0, remaining);
    const insertedQuestions = await Question.insertMany(docsToInsert);

    // Update topic question count
    const totalCount = await Question.countDocuments({ topicId: topic._id, userId: req.user._id });
    await Topic.findByIdAndUpdate(topic._id, { questionCount: totalCount });

    res.status(201).json({
      success: true,
      count: insertedQuestions.length,
      questions: insertedQuestions,
      message: `Generated ${insertedQuestions.length} AI questions successfully`,
    });
  } catch (error) {
    console.error('Generate questions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/questions/generate-ai/:topicId — alias for mobile compatibility
router.post('/generate-ai/:topicId', protect, async (req, res) => {
  try {
    const topic = await Topic.findOne({ _id: req.params.topicId, userId: req.user._id });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });

    const existingCount = await Question.countDocuments({ topicId: topic._id, userId: req.user._id });
    const remaining = Math.max(0, MAX_QUESTIONS_PER_TOPIC - existingCount);
    if (remaining === 0) {
      return res.status(400).json({
        success: false,
        code: 'TOPIC_QUESTION_LIMIT_REACHED',
        message: `This topic already has ${MAX_QUESTIONS_PER_TOPIC} questions. Delete some questions to generate more.`,
        limit: MAX_QUESTIONS_PER_TOPIC,
        current: existingCount,
      });
    }

    const aiQuestions = await generateQuestions(topic.title, topic.notes, topic.category);

    if (!aiQuestions || aiQuestions.length === 0) {
      return res.status(500).json({ success: false, message: 'AI failed to generate questions. Please try again.' });
    }

    const questionDocs = aiQuestions.map((q) => ({
      topicId: topic._id,
      userId: req.user._id,
      questionText: q.questionText || q.question || q.text || 'Missing question text',
      type: q.type || 'concept',
      difficulty: q.difficulty || 'medium',
      difficultyLevel: q.difficultyLevel || null,
      expectedConcepts: q.expectedConcepts || q.concepts || [],
      source: 'ai',
    }));

    const validDocs = questionDocs.filter(q => q.questionText !== 'Missing question text');
    if (validDocs.length === 0) {
      return res.status(500).json({ success: false, message: 'AI returned no valid questions.' });
    }

    const docsToInsert = validDocs.slice(0, remaining);
    const insertedQuestions = await Question.insertMany(docsToInsert);
    const totalCount = await Question.countDocuments({ topicId: topic._id, userId: req.user._id });
    await Topic.findByIdAndUpdate(topic._id, { questionCount: totalCount });

    res.status(201).json({
      success: true,
      count: insertedQuestions.length,
      questions: insertedQuestions,
      message: `Generated ${insertedQuestions.length} AI questions successfully`,
    });
  } catch (error) {
    console.error('Generate AI questions error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/questions/:id - Edit a question
router.put('/:id', protect, async (req, res) => {
  try {
    const { questionText, expectedConcepts, type, difficulty } = req.body;

    const question = await Question.findOne({ _id: req.params.id, userId: req.user._id });
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

    if (questionText !== undefined) {
      if (!String(questionText).trim()) {
        return res.status(400).json({ success: false, message: 'Question text cannot be empty' });
      }
      question.questionText = String(questionText).trim();
    }

    if (expectedConcepts !== undefined) {
      if (Array.isArray(expectedConcepts)) {
        question.expectedConcepts = expectedConcepts.map(c => String(c).trim()).filter(Boolean);
      } else if (typeof expectedConcepts === 'string') {
        question.expectedConcepts = expectedConcepts.split(',').map(c => c.trim()).filter(Boolean);
      } else {
        question.expectedConcepts = [];
      }
    }

    if (type !== undefined) question.type = type;
    if (difficulty !== undefined) question.difficulty = difficulty;

    await question.save();
    res.json({ success: true, question });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/questions/:id - Delete a question
router.delete('/:id', protect, async (req, res) => {
  try {
    const question = await Question.findOne({ _id: req.params.id, userId: req.user._id });
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });

    const topicId = question.topicId;
    await Question.findByIdAndDelete(question._id);

    const totalCount = await Question.countDocuments({ topicId, userId: req.user._id });
    await Topic.findByIdAndUpdate(topicId, { questionCount: totalCount });

    res.json({ success: true, message: 'Question deleted successfully' });
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
