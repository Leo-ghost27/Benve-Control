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

## Adding a new demo screen

Every task that adds a standalone `public/demos/*.html` product demo needs
**three** things wired up, not just the file — this has been missed
repeatedly across sessions, leaving demos unreachable from the actual app:

1. **The file itself** — `public/demos/your-demo-name.html`
2. **The index page** — add an entry to the `demos` array in
   `src/app/demos/page.tsx` (title, audience, description, `href`)
3. **The sidebar** — add a nav item to `navItems` in
   `src/components/dashboard/Sidebar.tsx` (label ending in `(Demo)`,
   matching `href`, `external: true` so it opens in a new tab)

Before finishing a task that adds a demo, verify all three are done by
running:

```bash
grep -o 'href: "/demos/[^"]*"' src/app/demos/page.tsx | sort > /tmp/index.txt
grep -o 'href: "/demos/[^"]*"' src/components/dashboard/Sidebar.tsx | sort > /tmp/sidebar.txt
diff /tmp/index.txt /tmp/sidebar.txt
```

Any lines only in `/tmp/index.txt` are demos missing from the sidebar —
except `testing-workbench.html` and `client-action-centre.html`, which are
intentionally excluded (their originating tasks never asked for a sidebar
entry, unlike every task since).

## Working with multiple contributors/sessions on this repo

More than one session/contributor pushes to this repo. **Always `git pull`
(or fetch + fast-forward) before pushing** — a force-push or a push from a
stale local clone has already silently overwritten other contributors'
commits once (lost work had to be manually rebuilt). If your local `main`
is behind `origin/main`, merge or rebase first; never force-push over
commits you haven't reviewed.
