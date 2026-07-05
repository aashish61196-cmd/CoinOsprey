# CoinOsprey Backend

Node.js / Express / MongoDB backend powering the CoinOsprey admin dashboard,
articles, comments, newsletter and live crypto data feed.

## Stack
- **Express** — REST API
- **MongoDB + Mongoose** — data storage
- **JWT (httpOnly cookie or Bearer token)** — auth
- **Multer** — local-disk image uploads (`public/uploads`)
- **Nodemailer** — transactional email (welcome, comment-approved, newsletter campaigns)
- **CoinGecko + alternative.me** — live market data & Fear/Greed index, cached 60s in memory

## 1. Setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set MONGO_URI, JWT_SECRET, ADMIN_EMAIL/PASSWORD, SMTP_* (optional)
```

If you don't have MongoDB locally, the fastest option is a free
[MongoDB Atlas](https://www.mongodb.com/atlas) cluster — paste its connection
string into `MONGO_URI`.

## 2. Seed the first admin user + default categories

```bash
npm run seed
```

This creates the admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in your
`.env`, plus categories like Bitcoin, Ethereum, DeFi, etc. **Change the
password after your first login.**

## 3. Run it

```bash
npm run dev     # nodemon, auto-restart
# or
npm start
```

The API starts on `http://localhost:5000` by default.

## 4. Open the admin dashboard

Open `public/admin-dashboard.html` directly in a browser (or serve it with
any static server). It talks to `http://localhost:5000` automatically when
run from `localhost`. Once you deploy the backend, edit the `API_BASE`
constant near the top of that file's `<script>` to point at your deployed
backend URL.

Log in with the admin email/password from your `.env`.

## API overview

| Area | Route | Notes |
|---|---|---|
| Auth | `POST /api/auth/register` `/login` `/logout` `GET /me` | JWT in httpOnly cookie + returned in body |
| Articles | `GET /api/articles` (public, published only) `POST/PUT/DELETE` (author/editor/admin) `GET /api/articles/admin/all` | slugs auto-generated |
| Comments | `POST /api/comments` (public, goes to "pending") `GET /api/comments/article/:id` (approved only) `PATCH /:id/status`, `DELETE /:id` (editor/admin) | |
| Newsletter | `POST /api/newsletter/subscribe`, `GET /unsubscribe?token=`, admin: `/admin/subscribers`, `/admin/campaign` | |
| Admin | `GET /api/admin/stats`, `/users`, `/categories` (+ CRUD) | dashboard data |
| Crypto | `GET /api/crypto/markets`, `/global`, `/fear-greed` | proxies + caches CoinGecko/alternative.me so your frontend ticker doesn't get rate-limited |
| SEO | `GET /sitemap.xml`, `/robots.txt`, `GET /api/seo/article/:slug` | |

All protected routes accept either the `token` httpOnly cookie (set
automatically on login) or an `Authorization: Bearer <token>` header — the
admin dashboard uses the Bearer header so it works across origins (e.g.
GitHub Pages frontend → separately-hosted backend).

## Deploying

GitHub Pages only serves static files, so this backend needs separate
hosting. Good free/cheap options: **Render**, **Railway**, **Fly.io**, or a
small VPS. Steps are the same everywhere:

1. Push this `backend/` folder to GitHub (same repo as your frontend, or a new one).
2. Create a new Web Service on your host, point it at this folder, build command `npm install`, start command `npm start`.
3. Set the same environment variables from `.env` in the host's dashboard (never commit `.env` itself).
4. Update `CLIENT_URL` to your GitHub Pages URL (`https://aashish61196-cmd.github.io`) so CORS allows it.
5. Update `API_BASE` in `admin-dashboard.html` (and any frontend fetch calls) to your new backend URL.

## Security notes

- Passwords are hashed with bcrypt; never stored in plaintext.
- Rate limiting is applied to `/api/auth` and `/api/comments` to slow brute-force/spam.
- `utils/validator.js`'s `basicSanitize` strips `<script>` tags and inline event handlers from article HTML, but is intentionally minimal — for production, swap in `sanitize-html` if authors are untrusted.
- Rotate `JWT_SECRET` and the seeded admin password before going live.
