const express = require('express');
const router = express.Router();
const Topic = require('../models/Topic');
const Question = require('../models/Question');
const { protect } = require('../middleware/auth');
const { generateQuestions, analyzeNotes } = require('../services/aiService');

// @POST /api/topics/analyze
router.post('/analyze', protect, async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ success: false, message: 'Notes are required' });
    
    const suggestion = await analyzeNotes(notes);
    res.json({ success: true, suggestion });
  } catch (error) {
    console.error('❌ NOTE ANALYSIS FAILED:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/topics
router.get('/', protect, async (req, res) => {
  try {
    const topics = await Topic.find({ userId: req.user._id }).sort({ updatedAt: -1 });
    res.json({ success: true, count: topics.length, topics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/topics/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const topic = await Topic.findOne({ _id: req.params.id, userId: req.user._id });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });
    res.json({ success: true, topic });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/topics
router.post('/', protect, async (req, res) => {
  try {
    const { title, notes, category, tags, color } = req.body;

    if (!title || !notes) {
      return res.status(400).json({ success: false, message: 'Title and notes are required' });
    }

    const topic = await Topic.create({
      userId: req.user._id,
      title,
      notes,
      category: category || 'Other',
      tags: tags || [],
      color: color || '#6C63FF',
      questionsGenerated: true, // Set to true so UI doesn't show "Generating..."
      questionCount: 0,
    });

    // We no longer auto-generate questions based on user request.
    // generateQuestionsForTopic(topic, req.user._id);

    res.status(201).json({ success: true, topic });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/topics/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const { title, notes, category, tags, color } = req.body;

    const topic = await Topic.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { title, notes, category, tags, color, questionsGenerated: false },
      { new: true }
    );

    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });

    // Re-generate questions when notes are updated
    await Question.deleteMany({ topicId: topic._id });
    generateQuestionsForTopic(topic, req.user._id);

    res.json({ success: true, topic });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/topics/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const topic = await Topic.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });

    // Also delete orphaned sessions and their answers
    const Session = require('../models/Session');
    const Answer = require('../models/Answer');
    
    // Find all sessions for the topic to delete their answers
    const sessions = await Session.find({ topicId: topic._id });
    const sessionIds = sessions.map(s => s._id);
    
    await Answer.deleteMany({ sessionId: { $in: sessionIds } });
    await Session.deleteMany({ topicId: topic._id });
    await Question.deleteMany({ topicId: topic._id });

    res.json({ success: true, message: 'Topic deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/topics/:id/regenerate
router.post('/:id/regenerate', protect, async (req, res) => {
  try {
    const topic = await Topic.findOne({ _id: req.params.id, userId: req.user._id });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });

    await Question.deleteMany({ topicId: topic._id });
    generateQuestionsForTopic(topic, req.user._id);

    res.json({ success: true, message: 'Questions regeneration started' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helper: async question generation
async function generateQuestionsForTopic(topic, userId) {
  try {
    const questions = await generateQuestions(topic.title, topic.notes, topic.category);

    if (questions && questions.length > 0) {
      // 🐛 Debugging: log the first question to see the structure the AI gave us
      console.log('--- AI RAW QUESTION SAMPLE ---');
      console.log(JSON.stringify(questions[0], null, 2));

      // 🛡️ Map with fallbacks in case AI used slightly different keys
      const questionDocs = questions.map((q) => ({
        topicId: topic._id,
        userId,
        questionText: q.questionText || q.question || q.text || q.question_text || 'Missing question text',
        type: q.type || 'concept',
        difficulty: q.difficulty || 'medium',
        difficultyLevel: q.difficultyLevel || null,
        expectedConcepts: q.expectedConcepts || q.expected_concepts || q.concepts || [],
        source: 'ai',
      }));

      // Filter out invalid items just in case
      const validDocs = questionDocs.filter(q => q.questionText !== 'Missing question text');

      if (validDocs.length > 0) {
        await Question.insertMany(validDocs);
        await Topic.findByIdAndUpdate(topic._id, {
          questionsGenerated: true,
          questionCount: validDocs.length,
        });

        console.log(`✅ Generated ${validDocs.length} questions for topic: ${topic.title}`);
      } else {
        throw new Error('AI returned valid JSON but no valid question formats.');
      }
    } else {
      throw new Error('AI returned an empty list of questions.');
    }
  } catch (err) {
    console.error(`❌ Failed to generate questions for ${topic.title}:`, err.message);
  }
}

module.exports = router;
