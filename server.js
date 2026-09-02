require('dotenv').config();
const app = require('./src/app');
const { connectDatabase } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log(`PreCheckd app listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
