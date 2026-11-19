# Standing O

**Letterboxd for live theatre.** Log, rate and remember every show you've seen.

> Theatre Diary was the working name for this project. The launch name is Standing O.

A Vite + React single-page app backed by Supabase (Auth + Postgres).
It deploys as a static site to Vercel or Netlify — there is no custom server.

## Features

- Email + password accounts (Supabase Auth); each user sees **only their own diary** (enforced by Postgres Row Level Security)
- Seeded catalog of 150+ real productions (Broadway, West End, US Tour), searchable and filterable — no poster art (rights)
- Fast log flow: pick a show (or add one manually), date, venue/city (prefilled, editable), half-star rating (0.5–5.0), seat, one-line review
- Diary cards (newest first, searchable), edit, two-step delete
- Stats: total shows, average rating, shows this year, distinct venues/cities, top-rated
- Wrapped card (per-year or all-time) with a PNG download drawn on canvas

Out of scope by design: social feed, following, ticketing, per-night cast.

## Local development

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Demo mode

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are **not** set, the app runs
fully in **demo mode**:

- Accounts and entries are stored in the browser's `localStorage` on that device only
- The UI is clearly labelled "Demo mode — data stays on this device until Supabase is connected"
- Demo auth is **not secure** — it's only for previewing the app before Supabase is wired up. Don't reuse a real password in demo mode.

As soon as both env vars are set (in `.env` locally, or in your host's settings), the app switches to production mode automatically — no code change needed.

## Supabase setup (production accounts + data)

1. Go to [supabase.com](https://supabase.com) and create a free account and a new project (pick a strong database password and save it in your password manager).
2. In the project dashboard, open **SQL Editor → New query**, paste in the whole of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the `profiles` and `diary_entries` tables, indexes, Row Level Security policies (own rows only), and a trigger that creates a profile row on signup.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon / public** key.
4. Create a `.env` file (copy `.env.example`) and set:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
   The anon key is designed to be public in a browser app — data is protected by RLS, not by hiding this key. Never put the `service_role` key in this app.
5. **Email confirmation choice:** by default Supabase requires new users to click a confirmation email before they can sign in. For a small private beta that's friction you may not want. To turn it off: **Authentication → Providers → Email → uncheck "Confirm email"**. Trade-off: anyone can sign up with an email they don't own. For a public launch, turn it back on.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or use the Vercel CLI / drag-and-drop import of the project folder in the Vercel dashboard — "Import Project").
2. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
3. In **Project Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as your `.env`).
4. Deploy. Every push to the repo redeploys automatically.

Netlify works the same way: build command `npm run build`, publish directory `dist`, same two env vars.

## Next steps

- **Custom domain:** in Vercel, Project → Settings → Domains, add your domain (e.g. standingotheater.com) and follow the DNS instructions at your registrar. HTTPS is automatic.
- Add the live URL to the **@standingotheater** Instagram bio.
- Turn email confirmation back on before a public launch (see step 5 above).
- Backups: Supabase free tier includes daily backups in the dashboard under Database → Backups.

## Project structure

```
index.html
src/
  main.jsx          entry point
  App.jsx           auth, log flow, diary, stats, Wrapped
  supabaseClient.js Supabase client + demo/production mode switch
  demoStore.js      localStorage demo-mode accounts + entries (demo only)
  data/catalog.js   seeded production catalog
  styles.css
supabase/
  schema.sql        tables, RLS policies, indexes, signup trigger
.env.example
```
