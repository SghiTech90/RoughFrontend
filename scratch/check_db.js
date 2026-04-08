const mongoose = require('mongoose');
const User = require('../src/models/User');
require('dotenv').config();

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const count = await User.countDocuments();
    console.log(`Total users in database: ${count}`);
    const users = await User.find().select('name email createdAt');
    console.log('Users:', JSON.stringify(users, null, 2));
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUsers();
