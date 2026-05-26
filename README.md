# Question Paper Generator

Greenfield MVP for generating, refining, editing, saving, and exporting question papers.

## Stack

- `frontend`: Next.js, React, TypeScript, Tailwind CSS, lucide-react.
- `backend`: Phoenix-compatible Elixir API skeleton with Ecto, Postgres, pgvector, Oban, Finch, and Gemini/OpenAI AI boundary modules.
- `shared`: API contract notes shared by frontend and backend.

Auth is intentionally excluded for this phase.

## Current Runtime Notes

Use Docker only for Postgres during local development, and run Phoenix with the
Elixir/Erlang installation on Windows.

```powershell
docker compose up -d
cd backend
mix deps.get
mix ecto.migrate
mix phx.server

cd frontend
npm run dev
```

## Environment

Copy `.env.example` to `.env` when running the backend.

```text
POSTGRES_HOST=localhost
POSTGRES_DB=qpg_dev
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.1
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_SMALL_MODEL=gemini-2.5-flash
GEMINI_LARGE_MODEL=gemini-2.5-pro
```

The app intentionally has no local fake-paper generator. If the backend, AI
provider, or owned source corpus is unavailable, generation/refinement fails
visibly instead of silently returning demo content.

## AI Routing and Parallel Generation

The backend includes a model-routing seam based on the decision tree:

- Parameter extraction and classification route to the small configured provider model.
- Initial paper generation routes to the medium configured provider model.
- Small post-generation fixes route to the small configured provider model.
- Whole-paper rewrites route to the large configured provider model.

Set `AI_PROVIDER=gemini` for Gemini or `AI_PROVIDER=openai` for OpenAI. Gemini uses function declarations/function responses for tool calling. OpenAI uses the Responses API tool loop.

The AI provider is responsible for returning the requested variant count. Long
generation runs are executed through Oban, while progress is streamed to the UI
over Phoenix Channels.

## Prompt Catalog

The prompt text now lives in one backend module:

- `backend/lib/qpg/ai/prompts.ex`

It contains:

- the main system prompt
- the parameter extraction prompt
- the generation prompt
- the refinement prompt
- the patch proposal prompt
- the tool registry used by the AI provider boundary

## Templates And Scope

Templates are optional. Users can upload a simple `.txt`, `.md`, or `.json` template from the frontend. The backend also exposes:

```text
GET /api/templates
POST /api/templates
```

Template hints can fill missing request fields and formatting details such as
section labels, instructions, marks pattern, margin/spacing, font size, text
color, page color, section order, marking-scheme placement, answer-key placement,
header/footer style, and image-derived layout notes.

Generation requests now support:

- `chapter_scope = single`: one chapter/topic only
- `chapter_scope = multiple`: use the provided `chapters` list
- `chapter_scope = full_syllabus`: distribute across indexed subject chapters

The editor stores plain text plus optional rich HTML per question/answer, so existing payloads remain compatible while the UI supports richer formatting.

## NCERT Source Ingestion

Put owned NCERT chapter files under `data/ncert/raw`. For the current Quadratic Equations test chapter, use this convention:

```text
data/ncert/raw/cbse/class-10/maths/quadratic-equations.pdf
```

Text files are easiest for v1 and are imported directly:

```text
data/ncert/raw/cbse/class-10/maths/quadratic-equations.txt
```

PDFs are supported when `pdftotext` is available in the runtime. If the Docker Elixir image cannot extract a PDF, place a same-name `.txt` file beside it, for example `quadratic-equations.txt`.

Run ingestion with local Mix:

```powershell
cd backend
mix qpg.ingest_ncert ../data/ncert/raw
```

Or with the Dockerized Elixir toolchain. The temporary container installs `poppler-utils` so PDF extraction can run inside Docker:

```powershell
docker run --rm --network question_default -e POSTGRES_HOST=postgres -e POSTGRES_DB=qpg_dev -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -v ${PWD}:/app -w /app/backend elixir:1.17 sh -lc "apt-get update && apt-get install -y poppler-utils && mix local.hex --force && mix local.rebar --force && mix qpg.ingest_ncert ../data/ncert/raw"
```

The importer writes to `source_documents` and `source_chunks`. `search_ncert`
and `search_pyq` read only the owned corpus stored in Postgres. They return an
empty result when nothing is available; they do not fabricate demo snippets.
NCERT import also refreshes the normalized catalog tables (`boards`,
`school_classes`, `subjects`, `chapters`, and `chapter_sections`) so the UI can
show chapter choices from the database. It also extracts example/exercise rows
into `ncert_questions`, which powers the Retrieval panel's chapter section list
and lets teachers import questions directly from entries like `EXERCISE 12.1`.

If you already imported NCERT files and want to rebuild the clickable question
rows, run:

```powershell
cd backend
mix qpg.ncert.questions --board CBSE --class-level 10 --subject Maths
```

Backend source-related code is grouped under:

- `backend/lib/qpg/sources.ex`
- `backend/lib/qpg/sources/ncert/import.ex`
- `backend/lib/qpg/sources/ncert/metadata.ex`

## PYQ Ingestion And Format Reference

Put owned/official PYQ text or PDFs under `data/pyq/processed`, then run:

```powershell
cd backend
mix qpg.ingest_pyq ../data/pyq/processed
```

PYQ import also extracts question-level rows into `pyq_questions` with internal
tags for board, class, subject, chapter/topic, section, question number, marks,
question type, and difficulty. If you already imported PYQs and want to retag
them after improving the tagger, run:

```powershell
cd backend
mix qpg.pyq.tag --board CBSE --class-level 10 --subject Maths
```

The `get_marking_scheme` AI tool reads the imported PYQ corpus to infer section
layout, question counts, marks per section, duration, and maximum marks. The
generator uses this as format inspiration and must still create fresh questions
from the user request, NCERT context, and PYQ patterns.

## Backend Bring-Up

After installing Elixir, Erlang, and Postgres with pgvector:

```powershell
cd backend
mix deps.get
mix ecto.create
mix ecto.migrate
mix run priv/repo/seeds.exs
mix phx.server
```

The planned API base is `http://localhost:4000/api`.

If Windows cannot find `mix` but Docker is available, use the containerized Elixir toolchain:

```powershell
docker compose up -d
docker run --rm -v ${PWD}:/app -w /app/backend elixir:1.17 sh -lc "mix local.hex --force && mix local.rebar --force && mix deps.get"
docker run --rm -v ${PWD}:/app -w /app/backend elixir:1.17 sh -lc "mix local.hex --force && mix local.rebar --force && mix compile --warnings-as-errors"
docker run --rm --network question_default -e POSTGRES_HOST=postgres -e POSTGRES_DB=qpg_dev -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -v ${PWD}:/app -w /app/backend elixir:1.17 sh -lc "mix local.hex --force && mix local.rebar --force && mix ecto.create && mix ecto.migrate && mix run priv/repo/seeds.exs"
docker run -d --name qpg-api --network question_default -p 4000:4000 -e POSTGRES_HOST=postgres -e POSTGRES_DB=qpg_dev -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e OPENAI_API_KEY=$env:OPENAI_API_KEY -v ${PWD}:/app -w /app/backend elixir:1.17 sh -lc "mix local.hex --force && mix local.rebar --force && mix phx.server"
```

## MVP Flows

- Generate from structured parameters.
- Generate from a free prompt normalized into the same request shape.
- Review multiple variants.
- Manually edit questions, marks, and answer key text.
- Ask AI for refinements and preview patch operations.
- Save versions.
- Export the selected version to printable PDF or DOCX-style document download.
