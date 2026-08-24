# Benve Control

The Digital Compliance Platform for Fintechs.

SOX 404/ICFR and OCC readiness—built for fintechs.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- ESLint
- `src/` directory
- Prepared for Supabase (no keys included — see below)

## Getting started locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Supabase

This app is wired to *use* Supabase but ships with **no keys of any kind**.
To connect it:

1. Copy `.env.local.example` to `.env.local`.
2. Fill in your own `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. `.env.local` is git-ignored — it will never be committed.

## Deploying

This repo is connected to Netlify. Set the same environment variables in
Netlify's site settings (never in code) before deploying.
