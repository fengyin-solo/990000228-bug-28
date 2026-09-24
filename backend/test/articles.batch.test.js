const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the app at a throwaway database before anything loads the db module.
process.env.DB_PATH = path.join(os.tmpdir(), `blog-batch-test-${process.pid}.db`);

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');
const { getDb } = require('../db/init');

let server;
let baseUrl;
const ids = {};

const seed = [
  { key: 'js', title: 'JavaScript 指南', body: 'JS 正文', summary: 'ES6 新特性', tags: 'JavaScript,前端' },
  { key: 'java', title: 'Java 入门', body: 'Java 正文', summary: 'Java 摘要', tags: 'Java,后端' },
  // tags stored with spaces around tokens on purpose
  { key: 'css', title: 'CSS 布局', body: 'CSS 正文', summary: '布局速查', tags: 'CSS, 前端, 布局' },
  { key: 'pct', title: '100% 完成的承诺', body: '百分号 正文', summary: '百分比', tags: '随笔' },
  { key: 'node', title: 'Node 流', body: 'Node 正文', summary: '流式处理', tags: 'Node.js,后端' }
];

before(async () => {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO articles (title, body, summary, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  seed.forEach((article, index) => {
    const ts = new Date(now - index * 3600000).toISOString();
    const info = stmt.run(article.title, article.body, article.summary, article.tags, ts, ts);
    ids[article.key] = info.lastInsertRowid;
  });

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  getDb().close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(process.env.DB_PATH + suffix);
    } catch {
      // ignore cleanup errors
    }
  }
});

async function postBatch(queries) {
  const res = await fetch(`${baseUrl}/api/articles/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries })
  });
  return { status: res.status, body: await res.json() };
}

test('mixed batch: every result stays aligned with its query', async () => {
  const { status, body } = await postBatch([
    { key: 'fe', type: 'list', tag: '前端', page: 1, limit: 1 },
    { key: 'detail', type: 'detail', id: ids.java },
    { key: 'all-tags', type: 'tags' },
    { key: 'search', type: 'list', search: '布局' }
  ]);

  assert.equal(status, 200);
  assert.equal(body.results.length, 4);
  assert.deepEqual(body.summary, { total: 4, succeeded: 4, failed: 0, ok: true });

  const [fe, detail, allTags, search] = body.results;

  // identity is echoed on every item: index, client key and normalized query
  assert.equal(fe.index, 0);
  assert.equal(fe.key, 'fe');
  assert.equal(fe.type, 'list');
  assert.deepEqual(fe.query, { tag: '前端', search: null, page: 1, limit: 1 });

  // pagination metadata belongs to this query's list content
  assert.deepEqual(fe.data.pagination, { total: 2, page: 1, limit: 1, totalPages: 2 });
  assert.equal(fe.data.articles.length, 1);
  assert.ok(Array.isArray(fe.data.articles[0].tags));

  assert.equal(detail.index, 1);
  assert.equal(detail.key, 'detail');
  assert.deepEqual(detail.query, { id: ids.java });
  assert.equal(detail.data.article.id, ids.java);
  assert.deepEqual(detail.data.article.tags, ['Java', '后端']);

  assert.equal(allTags.index, 2);
  assert.equal(allTags.key, 'all-tags');
  assert.deepEqual(
    allTags.data.tags,
    ['CSS', 'Java', 'JavaScript', 'Node.js', '前端', '后端', '布局', '随笔'].sort()
  );

  assert.equal(search.index, 3);
  assert.equal(search.data.pagination.total, 1);
  assert.equal(search.data.articles[0].id, ids.css);
});

test('partial failure: other results stay aligned, failures are traceable', async () => {
  const { status, body } = await postBatch([
    { key: 'ok-list', type: 'list', page: 1, limit: 2 },
    { key: 'missing', type: 'detail', id: 999999 },
    { key: 'ok-detail', type: 'detail', id: ids.js },
    { key: 'bad-type', type: 'nope' },
    'not-an-object',
    { key: 'bad-limit', type: 'list', limit: 0 }
  ]);

  // the batch itself succeeds; failures live on their own items
  assert.equal(status, 200);
  assert.equal(body.results.length, 6);
  assert.deepEqual(body.summary, { total: 6, succeeded: 2, failed: 4, ok: false });

  const [list, missing, detail, badType, notObj, badLimit] = body.results;

  assert.equal(list.ok, true);
  assert.equal(list.data.articles.length, 2);
  assert.equal(list.data.pagination.total, seed.length);

  assert.equal(missing.ok, false);
  assert.equal(missing.key, 'missing');
  assert.equal(missing.type, 'detail');
  assert.deepEqual(missing.query, { id: 999999 });
  assert.deepEqual(missing.error, {
    code: 'NOT_FOUND',
    message: 'Article not found',
    status: 404
  });

  // the failure above did not shift this result out of place
  assert.equal(detail.ok, true);
  assert.equal(detail.key, 'ok-detail');
  assert.equal(detail.data.article.id, ids.js);

  for (const item of [badType, notObj, badLimit]) {
    assert.equal(item.ok, false);
    assert.equal(item.error.code, 'INVALID_QUERY');
    assert.equal(item.error.status, 400);
  }

  // every item still carries its position for correlation
  body.results.forEach((result, index) => assert.equal(result.index, index));
});

test('re-submitting the same batch returns identical results', async () => {
  const queries = [
    { key: 'a', type: 'list', tag: '后端' },
    { key: 'b', type: 'detail', id: ids.node },
    { key: 'c', type: 'tags' }
  ];

  const first = await postBatch(queries);
  const second = await postBatch(queries);

  assert.equal(first.status, 200);
  assert.deepEqual(second.body, first.body);
});

test('batch list result matches the existing list endpoint field for field', async () => {
  const batch = await postBatch([{ type: 'list', tag: '前端', page: 1, limit: 1 }]);
  const res = await fetch(
    `${baseUrl}/api/articles?tag=${encodeURIComponent('前端')}&page=1&limit=1`
  );
  const legacy = await res.json();

  assert.deepEqual(batch.body.results[0].data, legacy);
});

test('legacy list endpoint keeps its response shape and defaults', async () => {
  const res = await fetch(`${baseUrl}/api/articles`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.deepEqual(Object.keys(body).sort(), ['articles', 'pagination']);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.limit, 10);
  assert.equal(body.pagination.total, seed.length);
  assert.equal(body.articles.length, seed.length);
  // newest first
  assert.equal(body.articles[0].id, ids.js);
  assert.ok(Array.isArray(body.articles[0].tags));
});

test('tag summary stays compatible with GET /api/tags', async () => {
  const batch = await postBatch([{ type: 'tags' }]);
  const res = await fetch(`${baseUrl}/api/tags`);
  const legacy = await res.json();

  assert.deepEqual(Object.keys(legacy), ['tags']);
  assert.deepEqual(batch.body.results[0].data, legacy);
});

test('detail endpoint keeps its response shape and 404 contract', async () => {
  const res = await fetch(`${baseUrl}/api/articles/${ids.css}`);
  assert.equal(res.status, 200);
  const article = await res.json();
  assert.equal(article.id, ids.css);
  // spaces around stored tokens are trimmed, as before
  assert.deepEqual(article.tags, ['CSS', '前端', '布局']);

  const missing = await fetch(`${baseUrl}/api/articles/424242`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Article not found' });
});

test('tag filter matches whole tokens only', async () => {
  const { body } = await postBatch([{ type: 'list', tag: 'Java' }]);
  const titles = body.results[0].data.articles.map((article) => article.title);
  // "Java" must not match the "JavaScript" article
  assert.deepEqual(titles, ['Java 入门']);

  const res = await fetch(`${baseUrl}/api/articles?tag=Java`);
  const legacy = await res.json();
  assert.deepEqual(
    legacy.articles.map((article) => article.title),
    ['Java 入门']
  );
});

test('search treats LIKE wildcards as literals', async () => {
  const { body } = await postBatch([{ type: 'list', search: '%' }]);
  assert.equal(body.results[0].data.pagination.total, 1);
  assert.equal(body.results[0].data.articles[0].id, ids.pct);

  const res = await fetch(`${baseUrl}/api/articles?search=${encodeURIComponent('%')}`);
  const legacy = await res.json();
  assert.equal(legacy.pagination.total, 1);
});

test('out-of-range page returns an empty page with consistent metadata', async () => {
  const { body } = await postBatch([{ type: 'list', page: 5, limit: 2 }]);
  const [result] = body.results;
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.articles, []);
  assert.deepEqual(result.data.pagination, { total: seed.length, page: 5, limit: 2, totalPages: 3 });
});

test('batch envelope validation', async () => {
  const payloads = [
    {},
    { queries: [] },
    { queries: 'nope' },
    { queries: Array.from({ length: 51 }, () => ({ type: 'tags' })) }
  ];

  for (const payload of payloads) {
    const res = await fetch(`${baseUrl}/api/articles/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(res.status, 400, JSON.stringify(payload));
  }
});
