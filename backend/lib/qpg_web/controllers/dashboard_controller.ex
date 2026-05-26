defmodule QpgWeb.DashboardController do
  use Phoenix.Controller, formats: [:json]

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.Repo

  def show(conn, _params) do
    summary = %{
      counts: counts(),
      recent_papers: recent_papers(),
      recent_runs: recent_runs(),
      templates: templates(),
      chapter_coverage: chapter_coverage(),
      difficulty_distribution: difficulty_distribution(),
      source_mix: source_mix()
    }

    Logging.info("api.dashboard.show.completed", %{
      counts: summary.counts,
      recent_paper_count: length(summary.recent_papers)
    })

    json(conn, summary)
  end

  defp counts do
    %{
      papers: scalar("SELECT count(*) FROM papers"),
      templates: scalar("SELECT count(*) FROM templates"),
      generation_runs: scalar("SELECT count(*) FROM generation_runs"),
      completed_runs: scalar("SELECT count(*) FROM generation_runs WHERE status = 'completed'"),
      ncert_questions: scalar("SELECT count(*) FROM ncert_questions"),
      pyq_questions: scalar("SELECT count(*) FROM pyq_questions"),
      question_bank_items: scalar("SELECT count(*) FROM question_bank_items"),
      chapters: scalar("SELECT count(*) FROM chapters")
    }
  end

  defp recent_papers do
    rows(
      """
      SELECT
        p.id::text,
        p.title,
        p.board,
        p.class_level,
        p.subject,
        p.status,
        p.updated_at,
        count(v.id)::int AS version_count,
        COALESCE(max(v.marks_total), 0)::int AS marks_total
      FROM papers p
      LEFT JOIN paper_versions v ON v.paper_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT 8
      """
    )
    |> Enum.map(fn [id, title, board, class_level, subject, status, updated_at, version_count, marks_total] ->
      %{
        id: id,
        title: title,
        board: board,
        class_level: class_level,
        subject: subject,
        status: status,
        updated_at: updated_at,
        version_count: version_count,
        marks_total: marks_total
      }
    end)
  end

  defp recent_runs do
    rows(
      """
      SELECT id::text, status, request, inserted_at
      FROM generation_runs
      ORDER BY inserted_at DESC
      LIMIT 8
      """
    )
    |> Enum.map(fn [id, status, request, inserted_at] ->
      %{
        id: id,
        status: status,
        request: request || %{},
        inserted_at: inserted_at
      }
    end)
  end

  defp templates do
    rows(
      """
      SELECT id::text, name, description, payload, formatting, inferred_params, updated_at
      FROM templates
      ORDER BY updated_at DESC
      LIMIT 8
      """
    )
    |> Enum.map(fn [id, name, description, payload, formatting, inferred_params, updated_at] ->
      %{
        id: id,
        name: name,
        description: description,
        payload: payload || %{},
        formatting: formatting || %{},
        inferred_params: inferred_params || %{},
        updated_at: updated_at
      }
    end)
  end

  defp chapter_coverage do
    rows(
      """
      SELECT
        c.id::text,
        c.name,
        c.position,
        COALESCE(n.count, 0)::int AS ncert_count,
        COALESCE(p.count, 0)::int AS pyq_count,
        COALESCE(q.count, 0)::int AS bank_count
      FROM chapters c
      LEFT JOIN (
        SELECT chapter_id, count(*) FROM ncert_questions GROUP BY chapter_id
      ) n ON n.chapter_id = c.id
      LEFT JOIN (
        SELECT lower(chapter) AS chapter, count(*) FROM pyq_questions GROUP BY lower(chapter)
      ) p ON p.chapter = lower(c.name)
      LEFT JOIN (
        SELECT lower(chapter) AS chapter, count(*) FROM question_bank_items GROUP BY lower(chapter)
      ) q ON q.chapter = lower(c.name)
      ORDER BY c.position NULLS LAST, c.name
      LIMIT 30
      """
    )
    |> Enum.map(fn [id, name, position, ncert_count, pyq_count, bank_count] ->
      total = ncert_count + pyq_count + bank_count

      %{
        id: id,
        name: name,
        position: position,
        ncert_count: ncert_count,
        pyq_count: pyq_count,
        bank_count: bank_count,
        total_sources: total,
        coverage_score: min(100, ncert_count * 2 + pyq_count * 8 + bank_count * 4)
      }
    end)
  end

  defp difficulty_distribution do
    rows(
      """
      SELECT difficulty, count(*)::int
      FROM (
        SELECT difficulty FROM ncert_questions
        UNION ALL
        SELECT difficulty FROM pyq_questions
        UNION ALL
        SELECT difficulty FROM question_bank_items
      ) source
      WHERE difficulty IS NOT NULL AND difficulty <> ''
      GROUP BY difficulty
      ORDER BY difficulty
      """
    )
    |> Enum.map(fn [difficulty, count] -> %{difficulty: difficulty, count: count} end)
  end

  defp source_mix do
    [
      %{source: "NCERT", count: scalar("SELECT count(*) FROM ncert_questions")},
      %{source: "PYQ", count: scalar("SELECT count(*) FROM pyq_questions")},
      %{source: "Question Bank", count: scalar("SELECT count(*) FROM question_bank_items")}
    ]
  end

  defp scalar(sql) do
    case SQL.query!(Repo, sql, []).rows do
      [[value]] -> value
      _ -> 0
    end
  end

  defp rows(sql), do: SQL.query!(Repo, sql, []).rows
end
