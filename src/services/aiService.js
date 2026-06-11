const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createChatCompletionWithRetry(payload, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await openai.chat.completions.create(payload, {
        timeout: 45000,
      });
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Generate questions from topic notes
 */
const generateQuestions = async (title, notes, category) => {
  const prompt = `You are an expert computer science tutor creating practice questions for: "${title}" (Category: ${category}).

User Notes:
${notes}

Generate exactly 5 questions following this strict difficulty ladder:

Level 1 — Basic: A simple definition or factual question about the topic.
Level 2 — Conceptual: A question testing understanding of the core idea.
Level 3 — Scenario: A real-world application or scenario-based question.
Level 4 — Application: Where or how this concept is used in practice.
Level 5 — Interview: A system design or deeper reasoning question (interview-level).

Even if notes are limited, use your internal knowledge to generate high-quality questions for the topic.

Return ONLY a valid JSON object:
{
  "questions": [
    {
      "questionText": "The question text",
      "type": "concept" | "explanation" | "scenario" | "practical" | "interview",
      "difficulty": "easy" | "medium" | "hard",
      "difficultyLevel": 1 | 2 | 3 | 4 | 5,
      "expectedConcepts": ["key concept 1", "key concept 2"]
    }
  ]
}

Rules:
- Generate exactly 5 questions, one per level.
- Level 1-2 should have difficulty "easy", Level 3 "medium", Level 4-5 "hard".
- Level 5 should be an interview-style system design question.
- Return ONLY the JSON, no other text.`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in generateQuestions');
      return [];
    }
    
    console.log('--- AI RAW CONTENT STRING ---');
    console.log(content);

    const parsed = JSON.parse(content);
    console.log('--- AI PARSED OBJECT PARAMS ---');
    console.log(Object.keys(parsed));
    
    // Handle both array and object with array
    if (Array.isArray(parsed)) return parsed;
    if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
    
    // Try to find an array in the response
    const arrays = Object.values(parsed).filter(v => Array.isArray(v));
    if (arrays.length > 0) return arrays[0];
    
    return [];
  } catch (err) {
    console.error('❌ Question Generation Error:', err.message);
    return [];
  }
};

const COVERAGE_STATUSES = ['covered', 'partial', 'missing', 'contradicted'];

/**
 * Normalize raw AI evaluation JSON into a consistent shape for API/DB.
 */
const normalizeEvaluation = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return { score: 0, overallFeedback: 'Failed to evaluate answer. Please try again.' };
  }

  const incorrectStatements = [];
  const seen = new Set();

  const pushStatement = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const whatYouSaid = String(entry.whatYouSaid || entry.claim || '').trim();
    const issue = String(entry.issue || entry.whyWrong || '').trim();
    const correction = String(entry.correction || entry.correct || '').trim();
    if (!whatYouSaid && !issue && !correction) return;
    const key = `${whatYouSaid}|${issue}|${correction}`;
    if (seen.has(key)) return;
    seen.add(key);
    incorrectStatements.push({ whatYouSaid, issue, correction });
  };

  const statementSources = [
    raw.incorrectStatements,
    raw.incorrect_statements,
    raw.wrongStatements,
    raw.factualErrors,
    raw.errors,
  ];
  statementSources.forEach((arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      if (typeof item === 'string') {
        const text = String(item).trim();
        if (text) pushStatement({ whatYouSaid: text, issue: '', correction: '' });
      } else {
        pushStatement(item);
      }
    });
  });

  const incorrectConcepts = [];
  const legacyIncorrect = raw.incorrectConcepts || raw.incorrectPoints || raw.wrongPoints || [];
  if (Array.isArray(legacyIncorrect)) {
    legacyIncorrect.forEach((item) => {
      const text = String(item || '').trim();
      if (!text) return;
      incorrectConcepts.push(text);
      pushStatement({ whatYouSaid: text, issue: '', correction: '' });
    });
  }

  const conceptCoverage = [];
  if (Array.isArray(raw.conceptCoverage)) {
    raw.conceptCoverage.forEach((row) => {
      const concept = String(row?.concept || row?.name || '').trim();
      const status = String(row?.status || row?.state || '').toLowerCase();
      if (!concept || !COVERAGE_STATUSES.includes(status)) return;
      conceptCoverage.push({ concept, status });
    });
  }

  conceptCoverage
    .filter((row) => row.status === 'contradicted')
    .forEach((row) => {
      pushStatement({
        whatYouSaid: `Your explanation of "${row.concept}"`,
        issue: 'This core concept was contradicted or stated incorrectly in your answer.',
        correction: `Review the correct understanding of: ${row.concept}`,
      });
    });

  const derivedIncorrectConcepts =
    incorrectConcepts.length > 0
      ? incorrectConcepts.slice(0, 3)
      : incorrectStatements.slice(0, 3).map((s) => {
          const parts = [];
          if (s.whatYouSaid) parts.push(`You said: "${s.whatYouSaid}"`);
          if (s.issue) parts.push(s.issue);
          if (s.correction) parts.push(`Correct: ${s.correction}`);
          return parts.join(' — ');
        });

  const rawScore = Number(raw.score);
  const score = Number.isFinite(rawScore)
    ? Math.min(10, Math.max(0, Math.round(rawScore)))
    : 5;

  return {
    score,
    correctPoints: (raw.correctPoints || []).slice(0, 3).map(String),
    missingConcepts: (raw.missingConcepts || []).slice(0, 3).map(String),
    incorrectConcepts: derivedIncorrectConcepts,
    incorrectStatements: incorrectStatements.slice(0, 3),
    suggestions: (raw.suggestions || []).slice(0, 3).map(String),
    overallFeedback: String(raw.overallFeedback || ''),
    interviewFeedback: String(raw.interviewFeedback || ''),
    correctExplanation: String(raw.correctExplanation || ''),
    keyPoints: (raw.keyPoints || []).slice(0, 3).map(String),
    followUpQuestion: String(raw.followUpQuestion || ''),
    conceptCoverage: conceptCoverage.slice(0, 8),
  };
};

/**
 * Evaluate a user's answer against expected concepts (Interview Mode)
 * @param {string} questionText - The question asked
 * @param {string} userTranscript - The candidate's spoken answer
 * @param {string[]} expectedConcepts - Core concepts the question is about
 * @param {string} topicTitle - Topic name (e.g., "HTML", "React")
 * @param {string} difficulty - "easy" | "medium" | "hard"
 */
const evaluateAnswer = async (questionText, userTranscript, expectedConcepts, topicTitle, difficulty = 'medium', notes = '') => {
  const difficultyContext = {
    easy: 'This is a beginner-level question. Evaluate accordingly — do not expect advanced or optional details.',
    medium: 'This is an intermediate-level question. Expect core concept coverage without requiring advanced edge cases.',
    hard: 'This is an advanced question. Expect the candidate to cover the main concepts with some depth.',
  }[difficulty] || '';

  const prompt = `You are an expert computer science tutor.

Topic: ${topicTitle}

User Notes:
${notes || '(No notes provided — use your internal knowledge of the topic)'}

Question: "${questionText}"

Core Concepts the answer should cover:
${expectedConcepts.map((c, i) => `${i + 1}. ${c}`).join('\n')}

User's Answer:
"${userTranscript}"

Difficulty: ${difficulty}
Context: ${difficultyContext}

IMPORTANT INSTRUCTIONS:
- Even if notes are limited, evaluate based on your knowledge of the topic.
- Actively scan the user's answer for factual errors, misconceptions, oversimplifications, and misleading claims.
- missingConcepts = important ideas they did NOT mention (omissions). Never put omissions in incorrectStatements.
- incorrectStatements = things they SAID that are wrong or misleading (commissions). REQUIRED field — use [] ONLY when every claim in their answer is accurate.
- If score is 6 or below, incorrectStatements MUST have at least 1 entry (factual error, misconception, or oversimplification).
- Common misconceptions and oversimplifications count as incorrectStatements even when the rest of the answer is partly right.
- Do NOT duplicate the same point in missingConcepts and incorrectStatements.
- suggestions = how to structure or improve the next answer (study tips, depth, examples) — not a repeat of missing/wrong lists.
- MAXIMUM 3 items in missingConcepts, incorrectStatements, correctPoints, suggestions, and keyPoints.
- correctExplanation should be a clear, ideal explanation of the correct answer (2-4 sentences).
- followUpQuestion should be a single natural follow-up question to deepen learning.
- interviewFeedback: only for hard/interview-level questions; otherwise use an empty string "".
- conceptCoverage: one entry per core concept listed above with status "covered" | "partial" | "missing" | "contradicted".
- If they contradict a core concept, include it in incorrectStatements AND mark that concept "contradicted" in conceptCoverage.
- Cap score at 6 if any core concept is contradicted or a major factual error is present, even if other parts are correct.

Evaluate and return ONLY this exact JSON structure, no other text:
{
  "score": <number 1-10>,
  "correctPoints": ["specific thing they said correctly"],
  "incorrectStatements": [
    {
      "whatYouSaid": "quote or paraphrase from their answer",
      "issue": "why this is wrong or misleading",
      "correction": "the accurate version"
    }
  ],
  "missingConcepts": ["core idea they omitted (max 3)"],
  "suggestions": ["actionable improvement for next time (max 3)"],
  "overallFeedback": "1-2 sentence honest tutor feedback",
  "interviewFeedback": "1 sentence interviewer verdict, or \"\" if not interview-level",
  "correctExplanation": "The ideal 2-4 sentence explanation of the correct answer",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "followUpQuestion": "A natural follow-up question to deepen learning",
  "conceptCoverage": [
    { "concept": "exact concept from the list above", "status": "covered" | "partial" | "missing" | "contradicted" }
  ]
}

Scoring guide:
- 9-10: Strong, confident answer — covers all key ideas clearly, no wrong claims
- 7-8: Good answer — covers main concepts, minor gaps acceptable, no major errors
- 5-6: Partial — got some ideas but missed important core ideas or has minor errors
- 3-4: Weak — significant gaps or multiple wrong/misleading statements
- 1-2: Mostly incorrect or very minimal understanding`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content:
            'You evaluate student answers strictly. Always populate incorrectStatements when the student states anything factually wrong, misleading, or a common misconception. Never leave incorrectStatements empty if the score is 6 or below unless every claim they made is accurate.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in evaluateAnswer');
      return normalizeEvaluation({ score: 0, overallFeedback: 'Failed to evaluate answer. Please try again.' });
    }

    return normalizeEvaluation(JSON.parse(content));
  } catch (err) {
    console.error('❌ Answer Evaluation Error:', err.message);
    return normalizeEvaluation({ score: 5, overallFeedback: 'Partially analyzed. Technical connection issue.' });
  }
};


/**
 * Generate a weekly learning insights report
 */
const generateInsights = async (userId, weeklyData) => {
  const prompt = `You are a learning analytics AI. Based on this week's learning data, generate personalized insights.

WEEKLY DATA:
- Total questions answered: ${weeklyData.totalAnswered}
- Average score: ${weeklyData.averageScore}/10
- Topics studied: ${weeklyData.topics.join(', ')}
- Strongest topic: ${weeklyData.strongestTopic} (${weeklyData.strongestScore}/10 avg)
- Weakest topic: ${weeklyData.weakestTopic} (${weeklyData.weakestScore}/10 avg)
- Study streak: ${weeklyData.streak} days

Generate insights in this JSON format:
{
  "summary": "2-3 sentence overview of the week",
  "strengths": ["strength 1", "strength 2"],
  "areasToImprove": ["area 1", "area 2", "area 3"],
  "recommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"],
  "motivationalMessage": "A personalized motivational message",
  "nextWeekFocus": ["topic or concept to focus on next week"]
}

Return ONLY the JSON object.`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in generateInsights');
      return { summary: 'No insights available right now.', strengths: [], areasToImprove: [] };
    }

    return JSON.parse(content);
  } catch (err) {
    console.error('❌ Insights Generation Error:', err.message);
    return { summary: 'Error analyzing weekly data.', strengths: [], areasToImprove: [] };
  }
};

/**
 * Analyze raw notes to suggest a title and category
 */
const analyzeNotes = async (notes) => {
  const prompt = `Analyze the following raw technical notes and suggest a title and category.
  
  CATEGORIES: [JavaScript, React, Node.js, SQL, MongoDB, CSS, HTML, System Design, Backend, Other]

  NOTES:
  ${notes.substring(0, 3000)}

  Return ONLY a valid JSON object:
  {
    "suggestedTitle": "Title",
    "suggestedCategory": "Category"
  }`;

  try {
    const response = await createChatCompletionWithRetry({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { suggestedTitle: 'New Topic', suggestedCategory: 'Other' };

    const parsed = JSON.parse(content);
    return {
      suggestedTitle: parsed.suggestedTitle || 'New Topic',
      suggestedCategory: parsed.suggestedCategory || 'Other',
    };
  } catch (error) {
    console.error('❌ Analyze Notes Error:', error.message);
    return { suggestedTitle: 'My New Topic', suggestedCategory: 'Other' };
  }
};

/**
 * Transcribe audio using OpenAI Whisper
 */
const transcribeAudio = async (audioBuffer, mimeType = 'audio/m4a') => {
  try {
    const { toFile } = require('openai');
    const response = await openai.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'recording.m4a'),
      model: 'whisper-1',
      language: 'en',  // Strictly enforce English — prevents Marathi/Hindi transcription
    });
    return response.text;
  } catch (error) {
    console.error('❌ Whisper Transcription Error:', error.message);
    throw new Error('Failed to transcribe audio.');
  }
};

module.exports = {
  generateQuestions,
  evaluateAnswer,
  normalizeEvaluation,
  generateInsights,
  analyzeNotes,
  transcribeAudio,
};
