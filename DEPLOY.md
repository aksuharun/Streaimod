# Deployment

## What to deploy

This repository is split into:

- `backend/`: Express + MongoDB + long-lived YouTube moderation runtime state.
- `frontend/`: Vite static app.

The backend keeps in-memory managed stream runtimes, so it is better on a long-running Node host such as Render than on a function-only platform.

## Dockerized local stack

1. Copy `.env.docker.example` to `.env.docker`.
2. Fill in the required secrets.
3. Start the stack:

```bash
docker compose up --build
```

The app will be available at `http://localhost:8080`.

## Recommended internet deployment

### Option A: Vercel frontend + Render backend + MongoDB Atlas

This is the free-tier-friendly deployment shape for the current codebase.

Backend on Render:

1. Push this repo to GitHub.
2. Use [render.yaml](/Users/aksuharun/Desktop/my-projects/ai-mod/render.yaml:1), which now defines a single free Node web service for the backend.
3. Set backend env vars:
   - `MONGODB_URI` from MongoDB Atlas
   - `OPENAI_API_KEY`
   - `RAISON_API_KEY`
   - `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=https://your-render-backend.onrender.com/api/auth/google/callback`
   - `FRONTEND_APP_URL=https://your-vercel-frontend-domain`
   - `CORS_ALLOWED_ORIGINS=https://your-vercel-frontend-domain`
4. Keep `SESSION_COOKIE_SAME_SITE=none` for cross-site browser requests.

Database on MongoDB Atlas:

1. Create a free Atlas cluster.
2. Create a database user.
3. Add Render egress access or temporarily allow `0.0.0.0/0`.
4. Put the Atlas connection string into `MONGODB_URI`.

Frontend on Vercel:

1. Import the repo as a Vercel project with root directory `frontend`, or run `vercel` from `frontend/`.
2. Set `VITE_BACKEND_ORIGIN=https://your-render-backend.onrender.com`.
3. The repo already includes [frontend/vercel.json](/Users/aksuharun/Desktop/my-projects/ai-mod/frontend/vercel.json:1) for SPA deep-link rewrites.

### Option B: All on Render (Paid)

Use this if you later want same-origin traffic and a self-hosted Mongo service on Render.

Backend on Render:

1. Create a Render web service from `backend/Dockerfile`, or keep using the backend service from `render.yaml` and expose it publicly instead of privately.
2. Use MongoDB Atlas or another reachable MongoDB instance, or keep Mongo on Render and use the backend's private-network config.
3. Set backend env vars:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `MONGODB_URI=...` or `MONGODB_HOSTPORT=...`
   - all OpenAI / Raison / Google OAuth secrets
   - `FRONTEND_APP_URL=https://your-frontend-domain`
   - `GOOGLE_REDIRECT_URI=https://your-backend-domain/api/auth/google/callback`
   - `CORS_ALLOWED_ORIGINS=https://your-frontend-domain`
   - `SESSION_COOKIE_SAME_SITE=none`

If you prefer same-origin routing through Vercel instead of direct cross-origin requests, add a rewrite once you know the backend URL:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-render-backend.onrender.com/api/:path*"
    },
    {
      "source": "/health",
      "destination": "https://your-render-backend.onrender.com/health"
    }
  ]
}
```

## If you do direct cross-origin API calls

If the frontend talks straight to the backend domain instead of using a rewrite or reverse proxy:

- set `VITE_BACKEND_ORIGIN` in the frontend build
- set `CORS_ALLOWED_ORIGINS` on the backend
- set `SESSION_COOKIE_SAME_SITE=none`
- keep `NODE_ENV=production` so cookies are also marked `Secure`

Without that cookie change, auth/session requests will fail across different sites such as `*.vercel.app` to `*.onrender.com`.

## Important env updates before production

- `GOOGLE_REDIRECT_URI` must use the public backend HTTPS URL for split-origin deploys.
- `FRONTEND_APP_URL` must use the public frontend URL.
- Use `MONGODB_URI` for external databases, or `MONGODB_HOSTPORT` plus `MONGODB_DATABASE` on private networks.
- `SESSION_SECRET` and `AUTH_TOKEN_ENCRYPTION_KEY` should be long random values.
