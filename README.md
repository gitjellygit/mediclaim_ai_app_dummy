# Claim AI MVP (v2) - Node + React + Postgres

## Run (local)
1) Start DB
- From project root:
  docker compose up -d

2) Backend
- cd backend
- cp .env.example .env
- npm install
- npx prisma migrate dev --name init
- node prisma/seed.js
- npm run dev
API: http://localhost:4000

3) Frontend
- cd frontend
- npm install
- npm run dev
UI: http://localhost:5173

## What you get
- Claims CRUD
- Document upload (PDF/images) stored locally in backend/uploads + metadata in DB
- "AI Check" (rule-based for now) -> score + issues
- Rules management (simple UI)
