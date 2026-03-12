require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Topic = require('../src/models/Topic');
const Question = require('../src/models/Question');

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🌱 Connected to MongoDB for seeding...');

    // 1. Clear existing data
    await User.deleteMany({});
    await Topic.deleteMany({});
    await Question.deleteMany({});
    console.log('🧹 Cleared existing data.');

    // 2. Create Test User
    const hashedPassword = await bcrypt.hash('password123', 10);
    const user = await User.create({
      name: 'Test Student',
      email: 'test@example.com',
      password: hashedPassword,
      preferences: {
        dailyGoal: 10,
        difficulty: 'mixed',
      },
      streak: {
        current: 3,
        longest: 5,
        lastActivity: new Date(),
      }
    });
    console.log('👤 Created Test User: test@example.com / password123');

    // 3. Create Topics
    const topics = [
      {
        userId: user._id,
        title: 'React Hooks',
        category: 'React',
        color: '#61DAFB',
        notes: 'Hooks let you use state and other React features without writing a class. useState for values, useEffect for side effects, useContext for global state. Custom hooks allow logic reuse. Rules: only call at the top level, only from React functions.',
        masteryLevel: 45,
      },
      {
        userId: user._id,
        title: 'CSS Flexbox',
        category: 'CSS',
        color: '#2965F1',
        notes: 'The Flexbox Layout (Flexible Box) module aims at providing a more efficient way to lay out, align and distribute space among items in a container. display: flex, justify-content for main axis, align-items for cross axis. flex-direction: row or column.',
        masteryLevel: 65,
      },
      {
        userId: user._id,
        title: 'SQL Joins',
        category: 'SQL',
        color: '#F29111',
        notes: 'INNER JOIN returns records that have matching values in both tables. LEFT JOIN returns all records from the left table and matched records from the right. RIGHT JOIN is opposite. FULL JOIN returns records when there is a match in either table.',
        masteryLevel: 30,
      }
    ];

    const createdTopics = await Topic.insertMany(topics);
    console.log(`📚 Created ${createdTopics.length} initial topics.`);

    // 4. Create Sample Questions for one topic
    const reactTopic = createdTopics[0];
    const questions = [
      {
        topicId: reactTopic._id,
        userId: user._id,
        questionText: 'What is the primary purpose of the useMemo hook?',
        type: 'concept',
        difficulty: 'medium',
        expectedConcepts: ['memoization', 'performance', 'expensive calculations'],
      },
      {
        topicId: reactTopic._id,
        userId: user._id,
        questionText: 'Explain the dependencies array in the useEffect hook.',
        type: 'explanation',
        difficulty: 'easy',
        expectedConcepts: ['stale closures', 'triggering effects', 'rerender control'],
      }
    ];

    await Question.insertMany(questions);
    console.log('❓ Added sample questions to "React Hooks".');

    console.log('✅ Seeding complete! You can now login with test@example.com / password123');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

seedData();
