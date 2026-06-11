const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/auth');
const { transcribeAudio } = require('../services/aiService');

// Use memory storage for audio uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit (Whisper max)
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/wav', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

// @POST /api/speech/transcribe
router.post('/transcribe', protect, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No audio file provided' });
    }

    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);

    if (!transcript || transcript.trim() === '') {
      return res.status(400).json({ success: false, message: 'Could not transcribe audio. Please speak clearly and try again.' });
    }

    res.json({ success: true, transcript: transcript.trim() });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ success: false, message: 'Transcription failed: ' + error.message });
  }
});

module.exports = router;
