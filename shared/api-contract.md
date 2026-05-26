# API Contract

## PaperRequest

```json
{
  "board": "CBSE",
  "class_level": "10",
  "subject": "Maths",
  "chapter": "Algebra",
  "topic": "Quadratic Equations",
  "source": "NCERT + PYQ",
  "question_types": ["MCQ", "Short", "Long"],
  "marking_scheme": "Standard board pattern",
  "difficulty": "Medium",
  "total_marks": 80,
  "duration_minutes": 180,
  "variant_count": 3
}
```

## Endpoints

- `POST /api/generation-runs`
  - Body: `{ "mode": "structured", "parameters": PaperRequest }` or `{ "mode": "free_prompt", "free_prompt": "..." }`.
  - Returns: run status, normalized request, variants, warnings, tool trace, and created paper ids.

- `GET /api/generation-runs/:id`
  - Returns: latest run status and generated variants.

- `GET /api/papers`
  - Returns: saved papers with versions.

- `GET /api/papers/:id`
  - Returns: one paper with version payloads.

- `POST /api/papers/:id/versions`
  - Body: `{ "change_source": "manual_edit", "payload": Paper }`.
  - Returns: created version id and number.

- `POST /api/papers/:id/refinements`
  - Body: `{ "instruction": "replace Q5 with a harder PYQ numerical" }`.
  - Returns: message, base version id, patch ops, and preview.

- `POST /api/papers/:id/exports`
  - Body: `{ "version_id": "...", "format": "pdf" }` or `{ "format": "docx" }`.
  - Returns: queued export id.

## Tool Calling Boundary

The Phoenix API owns all tool execution. The frontend sends user intent only.

- `search_ncert(filters, query, limit)`
- `search_pyq(filters, query, limit)`
- `get_marking_scheme(board, class, subject, exam_type)`
- `validate_paper(paper_json, target_constraints)`
- `rebalance_paper(paper_json, target_marks, difficulty_mix, question_types)`
- `swap_question(paper_id, question_id, replacement_constraints)`
- `format_paper(paper_json, template_id)`
- `generate_answer_key(paper_json, mode)`
- `apply_paper_patch(paper_version_id, patch_ops)`
