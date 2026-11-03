# Deploy: Neon + Vercel + GitHub Actions

Target cost: $0 a month. Nothing here is automated yet; these are the steps to do by hand once.

```
GitHub Actions (daily cron) ──writes──> Neon Postgres <──reads── Vercel (Next.js app)
```

## 1. Neon (Postgres)

1. Sign in at https://neon.tech with GitHub and create a project (Postgres 16 or newer, a region near you, for example US East).
2. On the project dashboard open **Connect**, pick the default branch and database, and turn on **Connection pooling**. Copy the pooled connection string. It looks like
   `postgresql://USER:PASSWORD@ep-example-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`
   (the host has `-pooler` in it). Use this one string everywhere below.
3. From your machine, create the tables and load real data:
   ```bash
   export DATABASE_URL='postgresql://...-pooler.../neondb?sslmode=require'
   python3 -m nba_pipeline migrate
   python3 -m nba_pipeline run --date "$(TZ=America/New_York date +%F)"
   ```
   To show the demo day instead, run `python3 -m nba_pipeline seed`.

Storage: about 50 MB per full season (box scores, gaps and deltas for every game), so the free tier's 0.5 GB holds several seasons. Free compute scales to zero after a few idle minutes; the first page view after that takes about a second longer. Limits change, so check https://neon.tech/pricing.

## 2. Vercel (web app)

1. Sign in at https://vercel.com with GitHub and **Add New > Project**, then import `philay3/nba-daily`.
2. Set **Root Directory** to `web`. Vercel detects Next.js; leave the build and output settings at their defaults.
3. Under **Environment Variables** add, for Production and Preview:
   - `DATABASE_URL`: the pooled Neon string from step 1.
   - `NEXT_PUBLIC_BRAND_HANDLE`: your handle for the studio graphics, for example `@yourhandle`.
4. Deploy. Every push to `main` redeploys. Pages render per request, so the build itself never needs the database.
5. Optional: Vercel's Neon integration can add `DATABASE_URL` for you; if it does, make sure it is the pooled string.

Cost: the Hobby plan is free but is for personal, non-commercial use. If the posts and videos start making money, Vercel expects the Pro plan ($20 a month per member). Check https://vercel.com/pricing.

## 3. GitHub Actions (daily pipeline)

1. In the repo on GitHub open **Settings > Secrets and variables > Actions > New repository secret**.
2. Name it `DATABASE_URL` and paste the pooled Neon string.
3. Open **Actions > Daily pipeline > Run workflow** to run it once by hand (you can type a date, or leave it empty for today in New York). The run summary shows the counts, any notes or warnings, and the digest; the ten dashboard JSON files are attached as an artifact for 14 days.
4. After that it runs on its own every morning at 9:45 a.m. New York time (`.github/workflows/daily.yml`). Without the secret the workflow skips cleanly instead of failing.

`.github/workflows/ci.yml` runs on every push and pull request: pytest against a Postgres service container, web typecheck, lint and build, and a Playwright smoke test against the seeded demo day.

Cost: Actions minutes are free and unlimited on a public repository. On a private repository the free plan includes 2,000 minutes a month; the daily job takes about 2 minutes per run (two runs a day, so roughly 120 minutes a month) and CI a few minutes per push. Check https://github.com/pricing.

## 4. After deploying

- Schema changes: edit `web/src/db/schema.ts`, run `npm --prefix web run db:generate`, commit the new SQL file. The daily workflow applies pending migrations before each run, or run `python3 -m nba_pipeline migrate` with the Neon string.
- If ESPN blocks GitHub's IP ranges, the run still loads box scores and stats, logs a note, and leaves lines and injuries empty for that day. Running the pipeline from home with `--date` fills them.
- Total: $0 a month on Neon Free, Vercel Hobby and GitHub Actions (public repo), as long as the use stays personal.
