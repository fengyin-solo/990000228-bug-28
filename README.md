# Blog Platform

A lightweight personal blog platform built with Vue 3 + Vite (frontend) and Node.js + Express (backend).

## Tech Stack

### Frontend
- **Vue 3** - Progressive JavaScript framework
- **Vite** - Next generation frontend tooling
- **Vue Router** - Official router for Vue.js
- **Pinia** - State management library
- **Element Plus** - Vue 3 UI component library
- **Axios** - HTTP client
- **Marked** - Markdown parser

### Backend
- **Node.js** - JavaScript runtime
- **Express** - Web application framework
- **better-sqlite3** - Fast SQLite3 library
- **jsonwebtoken** - JWT implementation
- **cors** - Cross-Origin Resource Sharing

## Project Structure

```
blog-platform/
├── frontend/          # Vue 3 + Vite frontend
│   ├── src/
│   │   ├── api/       # API client
│   │   ├── components/# Reusable components
│   │   ├── router/    # Vue Router configuration
│   │   ├── stores/    # Pinia stores
│   │   └── views/     # Page components
│   └── ...
├── backend/           # Node.js + Express backend
│   ├── db/            # Database initialization and seeds
│   ├── routes/        # API routes
│   ├── middleware/    # Express middleware
│   └── data/          # SQLite database file
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. **Clone or navigate to the project directory**

```bash
cd blog-platform
```

2. **Install backend dependencies**

```bash
cd backend
npm install
```

3. **Install frontend dependencies**

```bash
cd ../frontend
npm install
```

4. **Initialize the database with seed data**

```bash
cd ../backend
npm run seed
```

### Running the Application

1. **Start the backend server (port 3001)**

```bash
cd backend
npm run dev
```

The API server will start at `http://localhost:3001`

2. **Start the frontend development server (port 5173)**

Open a new terminal:

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173`

## Features

- **Article Management**: Create, read, update, and delete blog articles
- **Markdown Support**: Write articles in Markdown with live preview
- **Tag System**: Organize articles with tags and filter by tags (multi-select combinations supported)
- **Batch Queries**: Verify multiple query combinations (list pages, details, tag summary) in one request with per-item failure tracking
- **Pagination**: Navigate through articles with pagination (10 per page)
- **Admin Panel**: Protected admin area for managing articles
- **JWT Authentication**: Secure admin login with JSON Web Tokens

## API Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/login` | Admin login | No |
| GET | `/api/articles` | List articles (with pagination and tag filter) | No |
| GET | `/api/articles/:id` | Get single article | No |
| POST | `/api/articles/batch` | Run multiple read queries in one request | No |
| POST | `/api/articles` | Create new article | Yes |
| PUT | `/api/articles/:id` | Update article | Yes |
| DELETE | `/api/articles/:id` | Delete article | Yes |
| GET | `/api/tags` | Get all unique tags | No |

### Batch Queries

`POST /api/articles/batch` runs several read queries (list pages, article
details, tag summary) in a single submission. Every query may carry a client
`key`; each result echoes its `index`, `key`, `type` and the normalized
`query`, so results are merged by identity — never by array position — and a
failing query never shifts or drops the others.

```json
{
  "queries": [
    { "key": "frontend", "type": "list", "tag": "前端", "page": 1, "limit": 10 },
    { "key": "article-3", "type": "detail", "id": 3 },
    { "key": "tags", "type": "tags" }
  ]
}
```

Response (HTTP 200 even when some queries fail; failures are reported per
item with a traceable `error`):

```json
{
  "results": [
    { "index": 0, "key": "frontend", "type": "list", "query": { "tag": "前端", "search": null, "page": 1, "limit": 10 }, "ok": true, "data": { "articles": [], "pagination": { "total": 0, "page": 1, "limit": 10, "totalPages": 0 } } },
    { "index": 1, "key": "article-3", "type": "detail", "query": { "id": 3 }, "ok": false, "error": { "code": "NOT_FOUND", "message": "Article not found", "status": 404 } },
    { "index": 2, "key": "tags", "type": "tags", "query": {}, "ok": true, "data": { "tags": ["CSS", "Vue"] } }
  ],
  "summary": { "total": 3, "succeeded": 2, "failed": 1, "ok": false }
}
```

- `list` data matches `GET /api/articles` (`articles` + `pagination`)
- `detail` data is `{ "article": ... }` matching `GET /api/articles/:id`
- `tags` data matches `GET /api/tags` (`{ "tags": [...] }`)
- Re-submitting the same batch returns identical results (idempotent)
- At most 50 queries per batch; the home page uses this endpoint to load
  multiple selected tag combinations in one request

## Admin Credentials

- **Username**: admin
- **Password**: admin123

## Configuration

### Backend

- Server port: `3001` (configurable via `PORT` environment variable)
- JWT secret: `blog-platform-secret-key` (hardcoded in middleware/auth.js)
- Database file: `backend/data/blog.db`

### Frontend

- Dev server port: `5173`
- API proxy: `/api` requests are proxied to `http://localhost:3001`

## Build for Production

### Backend

The backend runs directly with Node.js:

```bash
cd backend
npm start
```

### Frontend

Build the frontend for production:

```bash
cd frontend
npm run build
```

The built files will be in `frontend/dist/`

## License

MIT
