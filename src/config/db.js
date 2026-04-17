const mongoose = require('mongoose');

let dbConnected = false;
let retryTimer = null;
const RETRY_MS = 5000;

const scheduleReconnect = () => {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    await connectDB();
  }, RETRY_MS);
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    dbConnected = true;
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    dbConnected = false;
    console.error(`❌ MongoDB Connection Error: ${error.message}`);

    // Keep local server alive in development so API logs can still be monitored.
    if (process.env.NODE_ENV === 'development') {
      console.log(`⚠️ Retrying MongoDB connection in ${RETRY_MS / 1000}s...`);
      scheduleReconnect();
      return;
    }

    process.exit(1);
  }
};

const isDBConnected = () => dbConnected;

module.exports = connectDB;
module.exports.isDBConnected = isDBConnected;
