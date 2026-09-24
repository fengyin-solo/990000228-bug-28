/**
 * Single read root for articles.
 *
 * Every read path (list page, detail page, tag summary and the batch endpoint)
 * goes through the functions in this file so that:
 *  - SQL building, tag parsing and response shaping are defined exactly once;
 *  - each batch result carries the identity of the query it answers
 *    (index + client key + the normalized query), so result merging never
 *    depends on array positions and stays correct after partial failures;
 *  - one failing query is reported on its own result item instead of failing
 *    the whole batch.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_BATCH_QUERIES = 50;

/** Error whose HTTP status / code should be reported on a single result item. */
class QueryError extends Error {
  constructor(status, code, message, { type, query } = {}) {
    super(message);
    this.name = 'QueryError';
    this.status = status;
    this.code = code;
    this.type = type || null;
    this.query = query;
  }
}

/** Parse the comma separated tags column exactly once, everywhere. */
function parseTags(tagsStr) {
  if (!tagsStr) return [];
  return tagsStr
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** Escape LIKE wildcards so user input cannot broaden the match. */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function toPositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return Number.isFinite(fallback) ? fallback : NaN;
  }
  return parsed;
}

/** Echo the request query without the envelope fields carried separately. */
function echoOf(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
    return rawQuery;
  }
  const { key, type, ...echo } = rawQuery;
  return echo;
}

/**
 * Normalize a list query.
 *
 * strict mode (batch) rejects malformed paging parameters; lenient mode
 * (GET /api/articles) keeps the historical "fall back to defaults" behavior.
 */
function normalizeListInput(raw = {}, { strict = false } = {}) {
  const tag = typeof raw.tag === 'string' && raw.tag.trim() ? raw.tag.trim() : null;
  const search =
    typeof raw.search === 'string' && raw.search.trim() ? raw.search.trim() : null;

  let page;
  let limit;

  if (strict) {
    page = toPositiveInt(raw.page, 1);
    limit = toPositiveInt(raw.limit, DEFAULT_LIMIT);
    if (page < 1 || !Number.isFinite(page)) {
      throw new QueryError(400, 'INVALID_QUERY', 'page must be a positive integer');
    }
    if (limit < 1 || limit > MAX_LIMIT || !Number.isFinite(limit)) {
      throw new QueryError(
        400,
        'INVALID_QUERY',
        `limit must be an integer between 1 and ${MAX_LIMIT}`
      );
    }
  } else {
    page = Math.max(1, toPositiveInt(raw.page, 1));
    limit = Math.min(MAX_LIMIT, Math.max(1, toPositiveInt(raw.limit, DEFAULT_LIMIT)));
  }

  return { tag, search, page, limit };
}

function buildWhereClause({ tag, search }) {
  const clauses = [];
  const params = [];

  if (tag) {
    // Match whole comma-delimited tokens ("Java" must not match "JavaScript")
    // and ignore whitespace around tokens.
    clauses.push(`REPLACE(',' || tags || ',', ' ', '') LIKE ? ESCAPE '\\'`);
    params.push(`%,${escapeLike(tag.replace(/\s+/g, ''))},%`);
  }

  if (search) {
    clauses.push(`(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')`);
    const term = `%${escapeLike(search)}%`;
    params.push(term, term);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

/** List page: { articles, pagination } — same shape as GET /api/articles. */
function queryArticleList(db, normalized) {
  const { tag, search, page, limit } = normalized;
  const offset = (page - 1) * limit;
  const { whereSql, params } = buildWhereClause({ tag, search });

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM articles ${whereSql}`)
    .get(...params);

  const rows = db
    .prepare(
      `SELECT id, title, summary, tags, created_at, updated_at
       FROM articles ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return {
    articles: rows.map((row) => ({ ...row, tags: parseTags(row.tags) })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/** Detail page: full article row — same shape as GET /api/articles/:id. */
function queryArticleDetail(db, rawId) {
  if (rawId === undefined || rawId === null || rawId === '') {
    throw new QueryError(400, 'INVALID_QUERY', 'detail query requires an id');
  }

  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    throw new QueryError(400, 'INVALID_QUERY', 'id must be a positive integer');
  }

  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!row) {
    throw new QueryError(404, 'NOT_FOUND', 'Article not found');
  }

  return { article: { ...row, tags: parseTags(row.tags) } };
}

/** Tag summary: { tags } — same shape as GET /api/tags. */
function queryTags(db) {
  const rows = db
    .prepare("SELECT tags FROM articles WHERE tags IS NOT NULL AND tags != ''")
    .all();

  const tagSet = new Set();
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      tagSet.add(tag);
    }
  }

  return { tags: Array.from(tagSet).sort() };
}

/**
 * Run one query of a batch and return its correlated payload.
 *
 * @returns {{ type: string, query: object, data: object }}
 * @throws {QueryError} carrying status/code/type/query for traceable failures
 */
function executeQuery(db, rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
    throw new QueryError(400, 'INVALID_QUERY', 'each query must be an object', {
      type: null,
      query: rawQuery
    });
  }

  const { type } = rawQuery;
  let echo;

  try {
    if (type === 'list') {
      echo = echoOf(rawQuery);
      const normalized = normalizeListInput(rawQuery, { strict: true });
      // success echoes the normalized query; a normalization failure still
      // carries the original (echoed) query for the client to inspect
      echo = normalized;
      return { type, query: normalized, data: queryArticleList(db, normalized) };
    }

    if (type === 'detail') {
      echo = echoOf(rawQuery);
      const data = queryArticleDetail(db, rawQuery.id);
      return { type, query: { id: Number(rawQuery.id) }, data };
    }

    if (type === 'tags') {
      return { type, query: {}, data: queryTags(db) };
    }

    throw new QueryError(400, 'INVALID_QUERY', `unknown query type: ${String(type)}`, {
      type: typeof type === 'string' ? type : null,
      query: echoOf(rawQuery)
    });
  } catch (err) {
    if (err instanceof QueryError) {
      err.type = err.type || (typeof type === 'string' ? type : null);
      if (err.query === undefined) {
        err.query = echo !== undefined ? echo : echoOf(rawQuery);
      }
    }
    throw err;
  }
}

/**
 * Batch read + merge root.
 *
 * Results are assembled in input order but every item echoes its index,
 * client key and normalized query, so callers merge by identity rather than
 * position. A failure for one query never removes or shifts another result.
 */
function runBatch(db, rawQueries) {
  const results = rawQueries.map((rawQuery, index) => {
    const key =
      rawQuery &&
      typeof rawQuery === 'object' &&
      !Array.isArray(rawQuery) &&
      (typeof rawQuery.key === 'string' || typeof rawQuery.key === 'number')
        ? rawQuery.key
        : null;

    try {
      const { type, query, data } = executeQuery(db, rawQuery);
      return { index, key, type, query, ok: true, data };
    } catch (err) {
      if (err instanceof QueryError) {
        return {
          index,
          key,
          type: err.type,
          query: err.query === undefined ? rawQuery : err.query,
          ok: false,
          error: { code: err.code, message: err.message, status: err.status }
        };
      }
      return {
        index,
        key,
        type:
          rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery)
            ? typeof rawQuery.type === 'string'
              ? rawQuery.type
              : null
            : null,
        query: rawQuery,
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to run query', status: 500 }
      };
    }
  });

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;

  return {
    results,
    summary: {
      total: results.length,
      succeeded,
      failed,
      ok: failed === 0
    }
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_BATCH_QUERIES,
  QueryError,
  parseTags,
  normalizeListInput,
  queryArticleList,
  queryArticleDetail,
  queryTags,
  executeQuery,
  runBatch
};
