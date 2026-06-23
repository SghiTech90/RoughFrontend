const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { planLifeEvent, buildContextSnapshot, loadMemories } = require('../services/assistantService');

// @POST /api/assistant/plan
// Personal OS (Mira) sends voice transcript + local task context; returns spoken coaching + schedule patch.
router.post('/plan', protect, async (req, res) => {
  try {
    const { rawTranscript, localContext, parsed, sessionId, voiceMode } = req.body;

    const result = await planLifeEvent(req.user, {
      rawTranscript,
      localContext: localContext || {},
      parsed,
      sessionId: sessionId || null,
      voiceMode: !!voiceMode,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Assistant plan error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/assistant/memory
router.get('/memory', protect, async (req, res) => {
  try {
    const memories = await loadMemories(req.user._id, 30);
    res.json({ success: true, memories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/assistant/context
// Returns merged context (Revision AI progress + user Mira goals). Personal OS adds local tasks client-side.
router.get('/context', protect, async (req, res) => {
  try {
    const localContext = {
      localTime: req.query.localTime,
      wakeCompleted: req.query.wakeCompleted === 'true',
      yogaCompleted: req.query.yogaCompleted === 'true',
      meditationCompleted: req.query.meditationCompleted === 'true',
    };

    const contextSnapshot = await buildContextSnapshot(req.user, localContext);

    res.json({
      success: true,
      contextSnapshot,
      mira: req.user.mira || {},
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/assistant/preferences
router.put('/preferences', protect, async (req, res) => {
  try {
    const allowed = [
      'wakeTime',
      'sleepTime',
      'questionsTarget',
      'questionsDeadline',
      'primaryGoal',
      'primaryGoalDeadline',
      'coachMode',
    ];

    const user = req.user;
    if (!user.mira) user.mira = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        user.mira[key] = req.body[key];
      }
    });

    await user.save();

    res.json({ success: true, mira: user.mira });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
