const OpenAI = require('openai');
const Answer = require('../models/Answer');
const MiraMemory = require('../models/MiraMemory');
const MiraChatTurn = require('../models/MiraChatTurn');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHAME_KEYWORDS = [
  'random girl',
  'wasting time on',
  'you are useless',
  'you will never',
  'pathetic',
];

const DEFAULT_MIRA = {
  wakeTime: '04:00',
  sleepTime: '22:30',
  questionsTarget: 100,
  questionsDeadline: '10:00',
  primaryGoal: 'get_job_within_60_days',
  coachMode: 'strict_coach',
};

function parseTimeOnToday(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function formatHHmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function daysLeftFromDeadline(deadline) {
  if (!deadline) return 60;
  const end = new Date(deadline);
  const now = new Date();
  return Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
}

async function getMorningProgress(userId, deadline = '10:00', target = 100) {
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = parseTimeOnToday(deadline);
  const now = new Date();
  const countEnd = now < windowEnd ? now : windowEnd;

  const questionsAnswered = await Answer.countDocuments({
    userId,
    createdAt: { $gte: windowStart, $lte: countEnd },
  });

  return {
    questionsAnswered,
    questionsAnsweredBeforeDeadline: questionsAnswered,
    questionsTarget: target,
    questionsDeadline: deadline,
    morningBlockPassed: now >= windowEnd,
    morningBlockMet: questionsAnswered >= target,
    minutesLeftInWindow: now < windowEnd ? Math.max(0, Math.floor((windowEnd - now) / 60000)) : 0,
    remaining: Math.max(0, target - questionsAnswered),
  };
}

async function buildContextSnapshot(user, localContext = {}) {
  const mira = { ...DEFAULT_MIRA, ...(user.mira || {}) };
  const progress = await getMorningProgress(
    user._id,
    mira.questionsDeadline,
    mira.questionsTarget
  );

  const now = new Date();
  const localTime = localContext.localTime || formatHHmm(now);

  return {
    localTime,
    date: (localContext.date || now.toISOString().split('T')[0]),
    timezone: localContext.timezone || 'Asia/Kolkata',
    wakeCompleted: !!localContext.wakeCompleted,
    wakeScheduledTime: localContext.wakeScheduledTime || mira.wakeTime,
    yogaCompleted: !!localContext.yogaCompleted,
    meditationCompleted: !!localContext.meditationCompleted,
    questionsAnsweredToday: progress.questionsAnswered,
    questionsAnsweredBeforeDeadline: progress.questionsAnsweredBeforeDeadline,
    questionsTarget: mira.questionsTarget,
    questionsDeadline: mira.questionsDeadline,
    morningBlockPassed: progress.morningBlockPassed,
    morningBlockMet: progress.morningBlockMet,
    primaryGoal: mira.primaryGoal,
    primaryGoalDaysLeft: daysLeftFromDeadline(mira.primaryGoalDeadline),
    sleepScheduledTime: localContext.sleepScheduledTime || mira.sleepTime,
    pendingTasks: Array.isArray(localContext.pendingTasks) ? localContext.pendingTasks : [],
    blockedAppsViolationsToday: localContext.blockedAppsViolationsToday || 0,
    streakDays: user.streak?.current || 0,
    userMood: localContext.userMood || 'unknown',
    userName: user.name,
    minutesLeftInMorningBlock: progress.minutesLeftInWindow,
  };
}

function quickIntentFromTranscript(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;

  if (/\b(yes|yeah|yep|ok|okay|done|ready|sure|go|completed|finished)\b/.test(t) && t.length < 40) {
    return { intent: 'report_completion', confidence: 0.95, entities: {} };
  }
  if (/\b(no|nope|snooze|later|wait|not now|five minutes|5 minutes)\b/.test(t) && t.length < 50) {
    return { intent: 'snooze_task', confidence: 0.95, entities: {} };
  }
  if (/\b(how am i|status|progress|update me)\b/.test(t)) {
    return { intent: 'ask_status', confidence: 0.9, entities: {} };
  }
  return null;
}

function buildSystemPrompt(user, context, { memories = [], chatHistory = [], voiceMode = false } = {}) {
  const mira = { ...DEFAULT_MIRA, ...(user.mira || {}) };
  const memoryBlock = memories.length
    ? `\nWHAT YOU REMEMBER ABOUT ${user.name}:\n${memories.map((m) => `- [${m.category}] ${m.content}`).join('\n')}`
    : '';
  const historyBlock = chatHistory.length
    ? `\nRECENT CONVERSATION:\n${chatHistory.map((t) => `${t.role}: ${t.content}`).join('\n')}`
    : '';

  const voiceRules = voiceMode
    ? `VOICE MODE (ChatGPT-style): Sound human and present. Use natural speech — contractions, brief pauses in text, occasional "look" or "listen". 2-5 sentences in message.spoken. Ask one follow-up when helpful. Set continueConversation: true unless user ends session.`
    : `Keep message.spoken to max 3 sentences.`;

  return `You are Mira — ${user.name}'s personal partner-coach integrated with DisciplineOS (tasks, app blocking) and Revision AI (study questions).

IDENTITY: Warm but elite. Emotional intelligence + spiritual grounding + Cristiano Ronaldo discipline mindset:
- Ronaldo energy: "Talent without hard work is nothing." Consistency beats motivation. Rest is strategic, not weakness.
- Emotional: Validate feelings first ("I hear you"), then guide. Never shame, insult, or attack relationships.
- Spiritual: Breath, meditation, purpose, gratitude. Suggest meditation when overwhelmed — not as escape, as reset.
- Partner: Remember their life (people, struggles, wins). Reference memories naturally.

GOALS:
- Wake ${mira.wakeTime}, sleep ${mira.sleepTime}
- ${mira.questionsTarget} questions by ${mira.questionsDeadline}
- ${mira.primaryGoal} (${context.primaryGoalDaysLeft} days left)

CURRENT STATE: ${JSON.stringify(context)}
${memoryBlock}
${historyBlock}

${voiceRules}

WHEN USER CAN'T STUDY / FEELS LOW: compassion_reset — suggest 1 hour real rest, 10 min meditation, then one small win (10 questions). Create tasks for meditation/rest if appropriate.

WHEN USER SHARES LIFE UPDATES: store_memory action + acknowledge warmly + connect to goals.

DEVICE ACTIONS — include in "actions" array when user asks:
- create_task: { "type":"create_task", "name":"Wash clothes", "time":"20:00", "mandatory":false, "aiEnabled":true } — adds to Setup routine
- store_memory: { "type":"store_memory", "category":"life|person|mood|goal", "content":"..." }
- open_screen: { "type":"open_screen", "screen":"routine_setup"|"app_picker" } — app_picker for blocking apps
- schedulePatch: still use for time blocks (add/move with taskId, label, start, end)

Also output: decision, reasonCode, message{spoken,display,tone}, schedulePatch[], actions[], followUp?, continueConversation (bool), metrics{riskLevel}

decision: allow|conditional_allow|deny|defer|clarify|celebrate|compassion_reset
reasonCode: MORNING_BLOCK_SAFE|MORNING_BLOCK_AT_RISK|MORNING_BLOCK_MISSED|CHORE_DEADLINE_CONFLICT|JOB_PREP_PROTECTED|GOAL_ESCALATION|PATTERN_WARNING|COMPASSION_RESET|STREAK_CELEBRATION|LOW_CONFIDENCE|EMERGENCY_OVERRIDE|SLEEP_PROTECTION|DISTRACTION_BLOCKED

Output ONLY valid JSON.`;
}

async function loadMemories(userId, limit = 20) {
  try {
    return await MiraMemory.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  } catch {
    return [];
  }
}

async function loadChatHistory(userId, sessionId, limit = 10) {
  if (!sessionId) return [];
  try {
    const turns = await MiraChatTurn.find({ userId, sessionId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return turns.reverse().map((t) => ({ role: t.role, content: t.content }));
  } catch {
    return [];
  }
}

async function saveChatTurn(userId, sessionId, role, content, actions = null) {
  if (!sessionId || !content) return;
  try {
    await MiraChatTurn.create({ userId, sessionId, role, content, actions });
  } catch (err) {
    console.error('saveChatTurn error:', err.message);
  }
}

async function persistMemoryActions(userId, actions = []) {
  for (const a of actions) {
    if (a?.type !== 'store_memory' || !a.content) continue;
    try {
      await MiraMemory.create({
        userId,
        category: a.category || 'life',
        content: String(a.content).slice(0, 500),
        tags: Array.isArray(a.tags) ? a.tags : [],
        source: 'voice',
      });
    } catch (err) {
      console.error('persistMemory error:', err.message);
    }
  }
}

function actionsToSchedulePatch(actions = []) {
  const patch = [];
  for (const a of actions) {
    if (a?.type === 'create_task' && a.name && a.time) {
      patch.push({
        action: 'add',
        taskId: `mira_${Date.now()}_${patch.length}`,
        label: a.name,
        start: a.time,
        isMandatory: !!a.mandatory,
      });
    }
  }
  return patch;
}

function validatePlannerResponse(raw, context, voiceMode = false) {
  const spoken = String(raw?.message?.spoken || '').trim();
  const sentences = spoken.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const maxSentences = voiceMode ? 6 : 4;
  const maxLen = voiceMode ? 800 : 500;

  if (sentences.length > maxSentences || spoken.length > maxLen) {
    if (voiceMode && spoken.length > 0) {
      const trimmed = sentences.slice(0, 5).join('. ') + '.';
      raw.message = { ...raw.message, spoken: trimmed, display: trimmed };
    } else {
      return buildFallbackResponse(context, 'Let me keep this simple. What do you need right now — rest, a task, or study?', voiceMode);
    }
  }

  const lower = spoken.toLowerCase();
  if (SHAME_KEYWORDS.some((k) => lower.includes(k))) {
    return buildFallbackResponse(
      context,
      `I hear you. You're at ${context.questionsAnsweredBeforeDeadline} of ${context.questionsTarget} today. One step at a time — what's the smallest win we can do next?`,
      voiceMode
    );
  }

  const atRisk =
    !context.morningBlockPassed &&
    context.questionsAnsweredBeforeDeadline < context.questionsTarget;

  if (atRisk && raw?.decision === 'allow' && raw?.reasonCode === 'MORNING_BLOCK_SAFE') {
    return buildFallbackResponse(
      context,
      `You're at ${context.questionsAnsweredBeforeDeadline} of ${context.questionsTarget} before ${context.questionsDeadline}. Let's protect that block — then we can talk about everything else.`,
      voiceMode
    );
  }

  const actions = Array.isArray(raw.actions) ? raw.actions : [];
  const schedulePatch = Array.isArray(raw.schedulePatch) ? raw.schedulePatch : [];

  return {
    decision: raw.decision || 'allow',
    reasonCode: raw.reasonCode || 'MORNING_BLOCK_SAFE',
    message: {
      spoken: spoken || buildStatusLine(context),
      display: raw?.message?.display || spoken,
      tone: raw?.message?.tone || (voiceMode ? 'warm' : 'firm'),
    },
    schedulePatch,
    actions,
    continueConversation: voiceMode ? raw.continueConversation !== false : !!raw.continueConversation,
    metrics: {
      questionsToday: context.questionsAnsweredToday,
      questionsBeforeDeadline: context.questionsAnsweredBeforeDeadline,
      questionsNeededByDeadline: Math.max(0, context.questionsTarget - context.questionsAnsweredBeforeDeadline),
      minutesLeftInMorningBlock: context.minutesLeftInMorningBlock ?? 0,
      riskLevel: raw?.metrics?.riskLevel || (atRisk ? 'high' : 'low'),
    },
    followUp: raw.followUp || null,
    choices: raw.choices || null,
  };
}

function buildStatusLine(context) {
  if (context.morningBlockMet) {
    return `Morning block done — ${context.questionsAnsweredBeforeDeadline} questions. ${context.primaryGoalDaysLeft} days to your job goal. What's next on your list?`;
  }
  if (!context.morningBlockPassed) {
    const left = context.questionsTarget - context.questionsAnsweredBeforeDeadline;
    return `You're at ${context.questionsAnsweredBeforeDeadline} of ${context.questionsTarget} — ${left} left before ${context.questionsDeadline}. Open Revision AI now.`;
  }
  return `Morning target missed. Schedule a catch-up block before any entertainment tonight.`;
}

function buildFallbackResponse(context, spoken, voiceMode = false) {
  return {
    decision: 'allow',
    reasonCode: context.morningBlockMet ? 'MORNING_BLOCK_SAFE' : 'MORNING_BLOCK_AT_RISK',
    message: { spoken, display: spoken, tone: voiceMode ? 'warm' : 'firm' },
    schedulePatch: [],
    actions: [],
    continueConversation: voiceMode,
    metrics: {
      questionsToday: context.questionsAnsweredToday,
      questionsBeforeDeadline: context.questionsAnsweredBeforeDeadline,
      questionsNeededByDeadline: Math.max(0, context.questionsTarget - context.questionsAnsweredBeforeDeadline),
      minutesLeftInMorningBlock: 0,
      riskLevel: context.morningBlockMet ? 'low' : 'high',
    },
    followUp: null,
    choices: null,
  };
}

function buildLocalPlannerResponse(intent, context) {
  if (intent.intent === 'ask_status') {
    return {
      decision: context.morningBlockMet ? 'allow' : 'conditional_allow',
      reasonCode: context.morningBlockMet ? 'MORNING_BLOCK_SAFE' : 'MORNING_BLOCK_AT_RISK',
      message: {
        spoken: buildStatusLine(context),
        display: buildStatusLine(context),
        tone: context.morningBlockMet ? 'warm' : 'firm',
      },
      schedulePatch: [],
      actions: [],
      metrics: {
        questionsToday: context.questionsAnsweredToday,
        questionsBeforeDeadline: context.questionsAnsweredBeforeDeadline,
        questionsNeededByDeadline: Math.max(0, context.questionsTarget - context.questionsAnsweredBeforeDeadline),
        riskLevel: context.morningBlockMet ? 'low' : 'high',
      },
    };
  }
  return null;
}

async function planWithOpenAI(user, context, rawTranscript, parsed, opts = {}) {
  const { memories = [], chatHistory = [], voiceMode = false } = opts;
  const payload = {
    life_event: { type: 'life_event', version: '2.0', rawTranscript, parsed, source: 'voice' },
    contextSnapshot: context,
    voiceMode,
  };

  const response = await openai.chat.completions.create({
    model: process.env.MIRA_MODEL || 'gpt-4o-mini',
    temperature: voiceMode ? 0.65 : 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt(user, context, { memories, chatHistory, voiceMode }) },
      ...chatHistory.slice(-6).map((t) => ({
        role: t.role === 'assistant' ? 'assistant' : 'user',
        content: t.content,
      })),
      { role: 'user', content: `Respond with planner JSON only:\n${JSON.stringify(payload)}` },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty planner response');
  return JSON.parse(content);
}

async function parseIntentWithOpenAI(rawTranscript) {
  const response = await openai.chat.completions.create({
    model: process.env.MIRA_MODEL || 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Extract intent from user speech for a discipline coach app.
Return JSON: { "intent": "<enum>", "entities": {}, "confidence": 0-1 }
intents: schedule_chore, schedule_social, schedule_study, schedule_work, report_completion, report_distraction, report_delay, ask_status, ask_plan, snooze_task, reschedule_day, set_goal, emergency_override, unknown`,
      },
      { role: 'user', content: rawTranscript },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return { intent: 'unknown', entities: {}, confidence: 0.3 };
  return JSON.parse(content);
}

async function planLifeEvent(user, {
  rawTranscript,
  localContext = {},
  parsed: clientParsed,
  sessionId = null,
  voiceMode = false,
}) {
  const context = await buildContextSnapshot(user, localContext);
  const transcript = String(rawTranscript || '').trim();

  const [memories, chatHistory] = await Promise.all([
    loadMemories(user._id, 20),
    loadChatHistory(user._id, sessionId, 10),
  ]);

  if (!transcript) {
    const greeting = voiceMode
      ? `Hey ${user.name}. I'm here — tell me what's going on, or say what you need me to set up.`
      : buildStatusLine(context);
    return {
      success: true,
      planner: buildFallbackResponse(context, greeting, voiceMode),
      contextSnapshot: context,
    };
  }

  const quick = quickIntentFromTranscript(transcript);
  if (!voiceMode && quick && quick.intent === 'ask_status') {
    return { success: true, planner: buildLocalPlannerResponse(quick, context), contextSnapshot: context, parsed: quick };
  }

  if (!voiceMode && quick && (quick.intent === 'report_completion' || quick.intent === 'snooze_task')) {
    return { success: true, planner: null, parsed: quick, contextSnapshot: context, deviceAction: quick.intent };
  }

  let parsed = clientParsed || quick;
  if (!voiceMode && (!parsed || parsed.confidence < 0.6)) {
    try {
      parsed = await parseIntentWithOpenAI(transcript);
    } catch (err) {
      console.error('Intent parse error:', err.message);
      parsed = { intent: 'unknown', entities: {}, confidence: 0.3 };
    }
  }

  if (!voiceMode) {
    const local = buildLocalPlannerResponse(parsed, context);
    if (local) {
      return { success: true, planner: local, contextSnapshot: context, parsed };
    }
  }

  try {
    await saveChatTurn(user._id, sessionId, 'user', transcript);
    const rawPlanner = await planWithOpenAI(user, context, transcript, parsed, {
      memories,
      chatHistory,
      voiceMode,
    });
    const planner = validatePlannerResponse(rawPlanner, context, voiceMode);
    await persistMemoryActions(user._id, planner.actions);
    await saveChatTurn(user._id, sessionId, 'assistant', planner.message.spoken, planner.actions);
    return { success: true, planner, contextSnapshot: context, parsed, sessionId };
  } catch (err) {
    console.error('Planner error:', err.message);
    return {
      success: true,
      planner: buildFallbackResponse(
        context,
        voiceMode
          ? "I'm having trouble connecting right now. Give me a second and try again."
          : buildStatusLine(context),
        voiceMode
      ),
      contextSnapshot: context,
      parsed,
      fallback: true,
    };
  }
}

module.exports = {
  planLifeEvent,
  buildContextSnapshot,
  getMorningProgress,
  validatePlannerResponse,
  buildStatusLine,
  loadMemories,
};
