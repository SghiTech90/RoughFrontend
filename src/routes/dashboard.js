const express = require('express');
const router = express.Router();
const Answer = require('../models/Answer');
const Session = require('../models/Session');
const Topic = require('../models/Topic');
const Question = require('../models/Question');
const { protect } = require('../middleware/auth');
const { generateInsights } = require('../services/aiService');

// @GET /api/dashboard
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    // Today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await Answer.countDocuments({
      userId,
      createdAt: { $gte: today },
    });

    // Overall stats
    const totalAnswers = await Answer.countDocuments({ userId });
    const allAnswers = await Answer.find({ userId });
    const avgScore =
      allAnswers.length > 0
        ? parseFloat((allAnswers.reduce((s, a) => s + a.score, 0) / allAnswers.length).toFixed(2))
        : 0;

    // Topic breakdown
    const topics = await Topic.find({ userId });
    const topicStats = await Promise.all(
      topics.map(async (topic) => {
        const topicAnswers = await Answer.find({ userId, topicId: topic._id });
        const topicAvg =
          topicAnswers.length > 0
            ? parseFloat((topicAnswers.reduce((s, a) => s + a.score, 0) / topicAnswers.length).toFixed(2))
            : 0;
        const revisionCount = await Session.countDocuments({
          userId,
          topicId: topic._id,
          questionsAnswered: { $gt: 0 },
        });
        const lastCompletedSession = await Session.findOne({
          userId,
          topicId: topic._id,
          questionsAnswered: { $gt: 0 },
        }).sort({ updatedAt: -1 });
        return {
          _id: topic._id,
          title: topic.title,
          category: topic.category,
          color: topic.color,
          masteryLevel: topic.masteryLevel,
          questionsAnswered: topicAnswers.length,
          averageScore: topicAvg,
          lastStudied: topic.lastStudied,
          questionCount: topic.questionCount,
          revisionCount,
          lastSessionScore: lastCompletedSession?.averageScore || 0,
        };
      })
    );

    // Incomplete / active sessions (for resume banners)
    const rawSessions = await Session.find({ userId, status: 'active' })
      .populate('topicId', 'title category color')
      .sort({ updatedAt: -1 })
      .limit(5);

    const incompleteSessions = await Promise.all(rawSessions.map(async (session) => {
      const Answer = require('../models/Answer');
      const answers = await Answer.find({ sessionId: session._id }).select('questionId');
      const answeredIds = answers.map(a => a.questionId.toString());
      
      let firstIdx = 0;
      if (session.questions && session.questions.length > 0) {
        for (let i = 0; i < session.questions.length; i++) {
          if (!answeredIds.includes(session.questions[i].toString())) {
            firstIdx = i;
            break;
          }
        }
      }
      
      // Convert to plain object and add the index
      const sObj = session.toObject();
      return { ...sObj, firstUnansweredIndex: firstIdx };
    }));

    // Weekly performance (last 7 days, grouped by day)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyAnswers = await Answer.find({
      userId,
      createdAt: { $gte: sevenDaysAgo },
    });

    const weeklyData = {};
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      weeklyData[key] = { date: key, count: 0, totalScore: 0, avgScore: 0 };
    }

    weeklyAnswers.forEach((a) => {
      const key = a.createdAt.toISOString().split('T')[0];
      if (weeklyData[key]) {
        weeklyData[key].count += 1;
        weeklyData[key].totalScore += a.score;
      }
    });

    Object.values(weeklyData).forEach((day) => {
      day.avgScore = day.count > 0 ? parseFloat((day.totalScore / day.count).toFixed(2)) : 0;
    });

    // Weak topics (avg score < 6)
    const weakTopics = topicStats.filter((t) => t.averageScore > 0 && t.averageScore < 6);

    // Recent sessions
    const recentSessions = await Session.find({ userId, status: 'completed' })
      .populate('topicId', 'title category color')
      .sort({ completedAt: -1 })
      .limit(5);

    // Questions due for review (spaced repetition)
    const dueCount = await Question.countDocuments({
      userId,
      nextReviewDate: { $lte: new Date() },
    });

    res.json({
      success: true,
      dashboard: {
        overview: {
          totalTopics: topics.length,
          totalAnswers,
          todayCount,
          averageScore: avgScore,
          accuracy: avgScore ? parseFloat(((avgScore / 10) * 100).toFixed(1)) : 0,
          streak: req.user.streak,
          dueForReview: dueCount,
        },
        topicStats: topicStats.sort((a, b) => b.averageScore - a.averageScore),
        weakTopics,
        weeklyPerformance: Object.values(weeklyData),
        recentSessions,
        incompleteSessions,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/dashboard/insights
router.get('/insights', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyAnswers = await Answer.find({ userId, createdAt: { $gte: sevenDaysAgo } })
      .populate('topicId', 'title');

    if (weeklyAnswers.length === 0) {
      return res.json({
        success: true,
        insights: {
          summary: "You haven't answered any questions this week. Start a revision session to get personalized insights!",
          strengths: [],
          areasToImprove: [],
          recommendations: ['Start with a topic you know well to build confidence.', 'Aim for at least 5 questions per day.'],
          motivationalMessage: 'Every expert was once a beginner. Start your learning journey today!',
          nextWeekFocus: [],
        },
      });
    }

    // Aggregate by topic
    const topicScores = {};
    weeklyAnswers.forEach((a) => {
      const title = a.topicId?.title || 'Unknown';
      if (!topicScores[title]) topicScores[title] = { total: 0, count: 0 };
      topicScores[title].total += a.score;
      topicScores[title].count += 1;
    });

    const topicAvgs = Object.entries(topicScores).map(([title, data]) => ({
      title,
      avg: parseFloat((data.total / data.count).toFixed(2)),
    }));

    const strongest = topicAvgs.sort((a, b) => b.avg - a.avg)[0] || { title: 'N/A', avg: 0 };
    const weakest = topicAvgs.sort((a, b) => a.avg - b.avg)[0] || { title: 'N/A', avg: 0 };
    const overallAvg = weeklyAnswers.reduce((s, a) => s + a.score, 0) / weeklyAnswers.length;

    const weeklyData = {
      totalAnswered: weeklyAnswers.length,
      averageScore: parseFloat(overallAvg.toFixed(2)),
      topics: Object.keys(topicScores),
      strongestTopic: strongest.title,
      strongestScore: strongest.avg,
      weakestTopic: weakest.title,
      weakestScore: weakest.avg,
      streak: req.user.streak.current,
    };

    const insights = await generateInsights(userId, weeklyData);

    res.json({ success: true, insights });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
