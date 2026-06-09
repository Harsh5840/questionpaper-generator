defmodule Mix.Tasks.Qpg.BackfillAssignments do
  @moduledoc """
  Backfills the prod-aligned `assignments` / `assignment_questions` tables from
  the legacy papers. For each paper it takes the latest paper_version payload
  (the current source of truth) and writes the equivalent assignment tree.

  Idempotent: re-running replaces each assignment's tree in place (keyed by
  `source_paper_id`). The legacy tables are left untouched.

  Usage:

      mix qpg.backfill_assignments
      mix qpg.backfill_assignments --verify   # also rebuild + report row counts
  """
  use Mix.Task
  import Ecto.Query

  alias Qpg.Repo
  alias Qpg.Assignments
  alias Qpg.Assignments.AssignmentQuestion
  alias Qpg.Papers.{Paper, PaperVersion}

  @shortdoc "Backfill assignments/assignment_questions from legacy papers"

  @impl true
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, switches: [verify: :boolean])
    verify? = Keyword.get(opts, :verify, false)

    start_repo_only()

    papers = Repo.all(from(p in Paper, order_by: [asc: p.inserted_at]))
    Mix.shell().info("Backfilling #{length(papers)} paper(s)…")

    {ok, skipped, failed} =
      Enum.reduce(papers, {0, 0, 0}, fn paper, {ok, skipped, failed} ->
        case latest_payload(paper.id) do
          nil ->
            Mix.shell().info("  · #{slug(paper.id)}  #{trim(paper.title)} — no version, skipped")
            {ok, skipped + 1, failed}

          payload ->
            case backfill_one(paper, payload, verify?) do
              :ok -> {ok + 1, skipped, failed}
              :error -> {ok, skipped, failed + 1}
            end
        end
      end)

    Mix.shell().info("\nDone. backfilled=#{ok} skipped=#{skipped} failed=#{failed}")
  end

  defp backfill_one(paper, payload, verify?) do
    case Assignments.upsert_from_payload(payload,
           source_paper_id: paper.id,
           board_code: paper.board,
           class_level: paper.class_level,
           subject: paper.subject,
           input_mode: paper.source_mode,
           status: paper.status
         ) do
      {:ok, assignment} ->
        rows =
          Repo.aggregate(
            from(q in AssignmentQuestion, where: q.assignment_id == ^assignment.id),
            :count
          )

        suffix =
          if verify? do
            rebuilt = Assignments.rebuild_payload(assignment)
            secs = rebuilt |> Map.get("sections", []) |> length()
            " (#{rows} rows, rebuilt #{secs} sections)"
          else
            " (#{rows} rows)"
          end

        Mix.shell().info("  ✓ #{slug(paper.id)}  #{trim(paper.title)}#{suffix}")
        :ok

      {:error, reason} ->
        Mix.shell().error("  ✗ #{slug(paper.id)}  #{trim(paper.title)} — #{inspect(reason)}")
        :error
    end
  end

  defp latest_payload(paper_id) do
    PaperVersion
    |> where([v], v.paper_id == ^paper_id)
    |> order_by([v], desc: v.version_number)
    |> limit(1)
    |> select([v], v.payload)
    |> Repo.one()
  end

  defp slug(id), do: id |> to_string() |> String.slice(0, 8)
  defp trim(nil), do: "(untitled)"
  defp trim(s), do: s |> to_string() |> String.slice(0, 40)

  defp start_repo_only do
    Mix.Task.run("app.config")
    {:ok, _} = Application.ensure_all_started(:logger)
    {:ok, _} = Application.ensure_all_started(:postgrex)
    {:ok, _} = Application.ensure_all_started(:ecto_sql)
    {:ok, _} = Application.ensure_all_started(:pgvector)

    case Process.whereis(Qpg.Repo) do
      nil -> {:ok, _pid} = Qpg.Repo.start_link()
      _pid -> :ok
    end
  end
end
