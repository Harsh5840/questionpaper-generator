defmodule Qpg.Repo.Migrations.CutoverToAssignments do
  use Ecto.Migration

  # Phase 2 — hard cutover. The assignments / assignment_questions tables (backfilled
  # in Phase 1) become the single source of truth for question papers. We:
  #
  #   1. Re-point the loose `paper_id` references on `exports` and `ai_usage_events`
  #      from old papers.id -> the matching assignments.id (via source_paper_id).
  #   2. Drop the legacy paper tables (papers, paper_versions, paper_sections,
  #      paper_questions, paper_question_options).
  #
  # The corpus / dump tables (ncert_questions, pyq_questions, question_bank_items,
  # chapters, source_documents, chunks, ...) are deliberately untouched.

  def up do
    # Drop the FK constraints first so the remap UPDATEs (which point paper_id at
    # rows that don't exist in `papers`) aren't rejected.
    drop_if_exists_constraint(:exports, "exports_paper_id_fkey")
    drop_if_exists_constraint(:exports, "exports_version_id_fkey")
    drop_if_exists_constraint(:ai_usage_events, "ai_usage_events_paper_id_fkey")

    # Re-point old paper ids -> new assignment ids using the backfill linkage.
    execute("""
    UPDATE exports e
    SET paper_id = a.id
    FROM assignments a
    WHERE a.source_paper_id = e.paper_id
    """)

    execute("""
    UPDATE ai_usage_events u
    SET paper_id = a.id
    FROM assignments a
    WHERE a.source_paper_id = u.paper_id
    """)

    # exports.paper_id was NOT NULL; relax it and drop the now-defunct version_id.
    alter table(:exports) do
      modify(:paper_id, :uuid, null: true)
      remove(:version_id)
    end

    # Null any reference that has no matching assignment, then re-add the FK.
    execute(
      "UPDATE exports SET paper_id = NULL WHERE paper_id IS NOT NULL AND paper_id NOT IN (SELECT id FROM assignments)"
    )

    execute(
      "UPDATE ai_usage_events SET paper_id = NULL WHERE paper_id IS NOT NULL AND paper_id NOT IN (SELECT id FROM assignments)"
    )

    alter table(:exports) do
      modify(:paper_id, references(:assignments, type: :uuid, on_delete: :delete_all))
    end

    alter table(:ai_usage_events) do
      modify(:paper_id, references(:assignments, type: :uuid, on_delete: :nilify_all))
    end

    # Drop legacy paper tables (children first so FKs unwind cleanly).
    drop(table(:paper_question_options))
    drop(table(:paper_questions))
    drop(table(:paper_sections))
    drop(table(:paper_versions))
    drop(table(:papers))
  end

  def down do
    raise Ecto.MigrationError,
      message:
        "cutover_to_assignments is irreversible — the legacy paper tables and version history are dropped. Restore from a backup if you need them."
  end

  defp drop_if_exists_constraint(table, name) do
    execute("ALTER TABLE #{table} DROP CONSTRAINT IF EXISTS #{name}")
  end
end
