require('dotenv').config();
console.log('🚀 Initializing Revision AI Backend...');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const connectDB = require('./src/config/db');

// Routes
const authRoutes = require('./src/routes/auth');
const topicRoutes = require('./src/routes/topics');
const questionRoutes = require('./src/routes/questions');
const sessionRoutes = require('./src/routes/sessions');
const answerRoutes = require('./src/routes/answers');
const dashboardRoutes = require('./src/routes/dashboard');
const speechRoutes = require('./src/routes/speech');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Root Welcome & Health Check
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Revision AI Backend is Running!', api_root: '/api' });
});

app.get('/api', (req, res) => {
  res.json({ success: true, message: 'Welcome to Revision AI API', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), service: 'Revision AI Backend' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/answers', answerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/speech', speechRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

console.log('🛠️ Middleware & Routes configured');

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Revision AI Server is LISTENING on port ${PORT}`);
  console.log(`📚 Environment: ${process.env.NODE_ENV || 'production'}`);
  
  // Connect to Database after starting the server to pass health checks
  if (process.env.MONGO_URI) {
    console.log('🔌 Connecting to MongoDB...');
    connectDB();
  } else {
    console.error('❌ ERROR: MONGO_URI is not defined in environment variables!');
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
});

module.exports = app;
