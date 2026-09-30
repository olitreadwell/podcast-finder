# Deployment

- Docker: `docker build -t app . && docker run -p 3000:3000 app`.
  Multi-stage, `node:22-alpine`, HEALTHCHECK on `/health`.
- Vercel: connect the repo; `npm run build` already ran green in CI.
- Env: every runtime setting comes from env vars (`.env.example` documents
  them). Never commit real keys.
