const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  const dbName = process.env.MONGODB_DB_NAME;
  if (!dbName) {
    throw new Error('MONGODB_DB_NAME is not set — this must be explicit per environment (e.g. "precheckd" for production, "precheckd-staging" for staging) to avoid accidentally writing to the wrong database.');
  }

  mongoose.connection.on('error', (err) => console.error('MongoDB connection error:', err));
  await mongoose.connect(uri, { dbName });
  console.log(`Connected to MongoDB (database: ${dbName})`);
  return mongoose.connection;
}

module.exports = { connectDatabase };