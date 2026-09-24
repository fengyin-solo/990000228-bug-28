const express = require('express');
const { getDb } = require('../db/init');
const { authenticateToken } = require('../middleware/auth');
const {
  MAX_BATCH_QUERIES,
  QueryError,
  normalizeListInput,
  queryArticleList,
  queryArticleDetail,
  queryTags,
  runBatch
} = require('../services/articleQueries');

const router = express.Router();

// POST /api/articles/batch - Run several read queries in one submission.
// Registered before "/"; partial failures are reported per result item,
// so this endpoint answers 200 as long as the batch itself is well formed.
router.post('/batch', (req, res) => {
  const db = getDb();
  const { queries } = req.body || {};

  if (!Array.isArray(queries)) {
    return res.status(400).json({ error: 'queries must be an array' });
  }
  if (queries.length === 0) {
    return res.status(400).json({ error: 'queries must not be empty' });
  }
  if (queries.length > MAX_BATCH_QUERIES) {
    return res
      .status(400)
      .json({ error: `at most ${MAX_BATCH_QUERIES} queries are allowed per batch` });
  }

  try {
    const batch = runBatch(db, queries);
    return res.json(batch);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to run batch query' });
  }
});

// GET /api/articles - List articles with pagination, tag filter and search
router.get('/', (req, res) => {
  const db = getDb();

  try {
    const normalized = normalizeListInput(req.query, { strict: false });
    const data = queryArticleList(db, normalized);
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// GET /api/articles/:id - Get single article
router.get('/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const { article } = queryArticleDetail(db, id);
    return res.json(article);
  } catch (err) {
    if (err instanceof QueryError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// POST /api/articles - Create article (requires auth)
router.post('/', authenticateToken, (req, res) => {
  const db = getDb();
  const { title, body, summary, tags } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  try {
    const tagsStr = Array.isArray(tags) ? tags.join(',') : (tags || '');
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO articles (title, body, summary, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, body, summary || '', tagsStr, now, now);

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      ...article,
      tags: article.tags ? article.tags.split(',').map(t => t.trim()) : []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// PUT /api/articles/:id - Update article (requires auth)
router.put('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { title, body, summary, tags } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required' });
  }

  try {
    const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const tagsStr = Array.isArray(tags) ? tags.join(',') : (tags || '');
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE articles SET title = ?, body = ?, summary = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `).run(title, body, summary || '', tagsStr, now, id);

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);

    res.json({
      ...article,
      tags: article.tags ? article.tags.split(',').map(t => t.trim()) : []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// DELETE /api/articles/:id - Delete article (requires auth)
router.delete('/:id', authenticateToken, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  try {
    const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Article not found' });
    }

    db.prepare('DELETE FROM articles WHERE id = ?').run(id);
    res.json({ message: 'Article deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

// GET /api/tags - Get all unique tags (exported for use in server.js)
function getTags(req, res) {
  const db = getDb();

  try {
    const data = queryTags(db);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
}

module.exports = router;
module.exports.getTags = getTags;
