const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    const response = await openai.chat.completions.create({
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
- A concise, correct answer that covers the main concepts deserves a 7–9 score.
- Only flag something as "missing" if it is CORE to a correct answer.
- MAXIMUM 3 items in missingConcepts. Pick only the most important ones.
- MAXIMUM 3 items in keyPoints (the 3 most important things to remember).
- correctExplanation should be a clear, ideal explanation of the correct answer (2-4 sentences).
- followUpQuestion should be a single natural follow-up question to deepen learning.
- interviewFeedback is a short interviewer-style comment (1-2 sentences).
- If the candidate's answer is correct and covers the key idea, score it 7 or above.

Evaluate and return ONLY this exact JSON structure, no other text:
{
  "score": <number 1-10>,
  "correctPoints": ["specific thing they said correctly", "another correct point"],
  "missingConcepts": ["most important missing concept (max 3 total)"],
  "incorrectConcepts": ["only if they said something factually wrong"],
  "suggestions": ["short actionable improvement tip (max 3 total)"],
  "overallFeedback": "1-2 sentence honest tutor feedback",
  "interviewFeedback": "1 sentence — would you move this candidate forward?",
  "correctExplanation": "The ideal 2-4 sentence explanation of the correct answer",
  "keyPoints": ["Key point 1 to remember", "Key point 2 to remember", "Key point 3 to remember"],
  "followUpQuestion": "A natural follow-up question to deepen learning"
}

Scoring guide:
- 9-10: Strong, confident answer — covers all key ideas clearly
- 7-8: Good answer — covers main concepts, minor gaps acceptable
- 5-6: Partial — got the basics but missed important core ideas
- 3-4: Weak — shows some awareness but significant gaps
- 1-2: Incorrect or very minimal understanding`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('AI returned empty content in evaluateAnswer');
      return { score: 0, overallFeedback: 'Failed to evaluate answer. Please try again.' };
    }

    return JSON.parse(content);
  } catch (err) {
    console.error('❌ Answer Evaluation Error:', err.message);
    return { score: 5, overallFeedback: 'Partially analyzed. Technical connection issue.' };
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
    const response = await openai.chat.completions.create({
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
    const response = await openai.chat.completions.create({
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
  generateInsights,
  analyzeNotes,
  transcribeAudio,
};
