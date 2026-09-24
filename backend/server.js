const express = require('express');
const cors = require('cors');
const path = require('path');
const initDb = require('./db/init');
const articlesRouter = require('./routes/articles');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
initDb();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/articles', articlesRouter);

// Tags route
const { getTags } = require('./routes/articles');
app.get('/api/tags', getTags);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start listening when run directly; tests import the app instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
