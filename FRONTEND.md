# Frontend — Move the Paper Generator Into Our App

The backend is done. The remaining work is the **UI**: right now this is a standalone
Next.js app, but it needs to become a **section inside our teacher web app** — which is
**React + Vite + pnpm + Apollo (GraphQL) + our own UI kit**, with auth already handled.

You don't need access to our repo. Refactor *this* app toward the conventions below so we
can lift your feature in as a drop-in section. You're swapping the **shell** (framework,
data layer, styling, auth) — not your actual product (the generator + paper builder stays).

---

## Target stack (what ours uses)
- **React + Vite** — no Next.js (no `app/`/`pages/` routing, no SSR, no `next/*`)
- **pnpm** — not npm
- **Apollo Client + GraphQL** — for all data (not REST/fetch)
- **React Router** — for any in-section navigation (not the Next router)
- **No auth/login** — the user is already logged in; token + tenant are injected for you

---

## What to do

### 1. De-Next.js → React + Vite
- Stand up a Vite app (`@vitejs/plugin-react`); drop `next dev`/`next build`.
- Remove every `next/*` import (`next/router`, `next/link`, `next/image`, `next/head`,
  server components, `app/` or `pages/` routing).
- Turn each page into a plain React component. The whole generator should become **one
  mountable component**, e.g. `<PaperGeneratorPage />`.
- Use **React Router** for internal steps/tabs.

### 2. Switch to pnpm
- Remove `package-lock.json`; use `pnpm install`. Keep dependencies minimal.

### 3. Data layer: REST → Apollo GraphQL
- Remove all `fetch('/api/...')` REST calls.
- Put every operation in a `.graphql` file under `src/graphql/paper-generator/`
  (no inline ``gql` ` ``) and use Apollo hooks (`useQuery` / `useMutation`).
- **Don't create the Apollo client at your app root** — assume the host provides the
  `ApolloProvider`. For local dev you may create one in a single file pointing at your
  backend, but keep it isolated so it's easy to remove.
- Put **all** network calls behind one small `src/api/` layer, so later we can repoint
  them at our mutations in a single file.

### 4. Styling: drop Tailwind
- Remove Tailwind (`tailwind.config`, `@tailwind` directives, utility classes).
- Keep styling **component-scoped and minimal** (CSS modules or plain CSS-in-JS) with
  clean semantic markup, so it can be swapped for our UI kit later. Avoid deep
  utility-class trees.

### 5. Auth: remove it
- Delete any login/signup/session UI and any token handling.
- Assume the `Authorization` + tenant headers are injected by the host. Don't read,
  store, or refresh tokens yourself.

### 6. Make it drop-in
- Ship the feature as: **one component + its `.graphql` files + its `src/api/` layer**,
  with **no global side effects** (no app-level providers, no root router — those come
  from the host).
- It must mount cleanly as a route like `/teacher/assignments/paper-generator` inside a
  host React app.

---

## Keep (do NOT rewrite)
Your generation flow, the paper-builder layout, the editor interactions, and the
question / section / parts / OR structure — all your real product logic stays. You're
changing the wrapper, not the feature.

## You do NOT need to
- Build auth, tenancy, S3, or touch the Elixir backend further — we handle those.
