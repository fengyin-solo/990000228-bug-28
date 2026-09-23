const express = require('express');
const { getDb } = require('../db/init');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Shared query helpers
//
// Every read path (list, detail, batch and tag aggregation) is built on the
// helpers below, so filtering, pagination math and result shaping stay
// consistent no matter how many query combinations are merged together.
// ---------------------------------------------------------------------------

const LIST_COLUMNS = 'id, title, summary, tags, created_at, updated_at';

// Split the comma-separated tags column into trimmed tag names.
function splitTags(tagsStr) {
  return tagsStr ? tagsStr.split(',').map(tag => tag.trim()) : [];
}

// Shape an article row for API responses (tags column -> tags array).
function parseArticle(article) {
  if (!article) return null;
  return {
    ...article,
    tags: splitTags(article.tags)
  };
}

// Build the WHERE clause and its bound parameters for list queries. The same
// parameter list feeds both the COUNT and the SELECT statement, so pagination
// metadata always describes the page content actually returned.
function buildListFilters({ tag, search } = {}) {
  const whereClauses = [];
  const filterParams = [];

  if (tag) {
    whereClauses.push(`',' || tags || ',' LIKE ?`);
    filterParams.push(`%,${tag},%`);
  }

  if (search) {
    whereClauses.push(`(title LIKE ? OR summary LIKE ?)`);
    const searchTerm = `%${search}%`;
    filterParams.push(searchTerm, searchTerm);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  return { whereSql, filterParams };
}

// Run one paginated list query:
//   { page, limit, tag, search } -> { articles, pagination }
function queryArticleList(options = {}) {
  const db = getDb();
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;
  const tag = options.tag || null;
  const search = options.search || null;
  const offset = (page - 1) * limit;

  const { whereSql, filterParams } = buildListFilters({ tag, search });

  const { total } = db
    .prepare(`SELECT COUNT(*) as total FROM articles ${whereSql}`)
    .get(...filterParams);
  const articles = db
    .prepare(`SELECT ${LIST_COLUMNS} FROM articles ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...filterParams, limit, offset);

  return {
    articles: articles.map(parseArticle),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}

// Fetch one article by id, or null when it does not exist.
function queryArticleDetail(id) {
  const db = getDb();
  return parseArticle(db.prepare('SELECT * FROM articles WHERE id = ?').get(id));
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

// GET /api/articles - List articles with pagination, tag filter and search
router.get('/', (req, res) => {
  try {
    res.json(queryArticleList(req.query));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// Maximum number of query combinations accepted in a single batch request.
const MAX_BATCH_QUERIES = 50;

// Execute one batch entry. List entries mirror GET /api/articles and detail
// entries mirror GET /api/articles/:id; a failure is reported in place (with
// the entry's index) so one bad combination never shifts the other results.
function runBatchQuery(query, index) {
  const base = { index };

  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { ...base, success: false, error: 'Query must be an object' };
  }

  const type = query.type || (query.id !== undefined ? 'detail' : 'list');

  try {
    if (type === 'detail') {
      const id = Number(query.id);
      if (!query.id || !Number.isInteger(id) || id <= 0) {
        return { ...base, type, success: false, error: 'A valid article id is required' };
      }
      const article = queryArticleDetail(id);
      if (!article) {
        return { ...base, type, success: false, error: 'Article not found' };
      }
      return { ...base, type, success: true, data: article };
    }

    if (type === 'list') {
      return { ...base, type, success: true, data: queryArticleList(query) };
    }

    return { ...base, type, success: false, error: `Unknown query type: ${type}` };
  } catch (err) {
    console.error(`Batch query #${index} failed:`, err);
    return { ...base, type, success: false, error: 'Failed to execute query' };
  }
}

// POST /api/articles/batch - Check multiple query combinations in one request.
//
// Body: { queries: [ { page, limit, tag, search } | { id } | { type, ... } ] }
// Each entry is either a list query (same parameters as GET /api/articles)
// or a detail query ({ id }, same result as GET /api/articles/:id). The
// response holds exactly one result per query at the same index, each with
// its own success flag, so pagination metadata, list content and detail
// results always line up with their query — even when some of them fail.
router.post('/batch', (req, res) => {
  const queries = req.body && req.body.queries;

  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'Request body must be { queries: [...] } with at least one query' });
  }
  if (queries.length > MAX_BATCH_QUERIES) {
    return res.status(400).json({ error: `Too many queries: at most ${MAX_BATCH_QUERIES} per batch` });
  }

  const results = queries.map((query, index) => runBatchQuery(query, index));
  res.json({ results });
});

// GET /api/articles/:id - Get single article
router.get('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const article = queryArticleDetail(id);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch article' });
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

    res.status(201).json(parseArticle(article));
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

    res.json(parseArticle(article));
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
    const articles = db.prepare(`SELECT tags FROM articles WHERE tags IS NOT NULL AND tags != ''`).all();
    const tagSet = new Set();

    articles.forEach(article => {
      splitTags(article.tags).forEach(tag => {
        if (tag) tagSet.add(tag);
      });
    });

    const tags = Array.from(tagSet).sort();
    res.json({ tags });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
}

module.exports = router;
module.exports.getTags = getTags;
