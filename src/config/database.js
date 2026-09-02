const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  mongoose.connection.on('error', (err) => console.error('MongoDB connection error:', err));
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  return mongoose.connection;
}

module.exports = { connectDatabase };
