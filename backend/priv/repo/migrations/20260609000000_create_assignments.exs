defmodule Qpg.Repo.Migrations.CreateAssignments do
  use Ecto.Migration

  # Prod-aligned 2-table model for a question paper:
  #
  #   assignments           — the paper (identity + rules), one row per paper.
  #   assignment_questions  — ONE tree. Sections, questions, sub-parts and
  #                           OR-alternatives are all rows linked by parent_id.
  #
  # Queryable metadata = columns; rich text + MCQ options = one `body_store`
  # jsonb blob per row (same shape we can later move behind an S3 pointer).
  #
  # Phase 1 is ADDITIVE: these tables are created alongside the legacy
  # papers / paper_versions / paper_sections / paper_questions / paper_question_options.
  # The legacy tables keep the running app working; a backfill populates these.
  # The cutover migration (re-point generation_runs/ai_usage_events/exports,
  # drop the superseded tables, retire paper_versions to history-only) is Phase 2.

  def change do
    create table(:assignments, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:tenant_id, :text)
      add(:title, :text, null: false)
      add(:board_code, :text)
      add(:class_level, :text)
      add(:subject, :text)
      add(:instructions, :text)
      add(:input_mode, :text)
      add(:status, :text, null: false, default: "draft")
      add(:total_marks, :integer, default: 0)
      add(:due_date, :utc_datetime)
      # Transition link back to the legacy paper so backfill / dual-write stays
      # idempotent. Dropped in the Phase 2 cutover.
      add(:source_paper_id, :uuid)
      timestamps(type: :utc_datetime)
    end

    create(index(:assignments, [:status]))
    create(index(:assignments, [:class_level, :subject]))
    create(index(:assignments, [:tenant_id]))
    create(unique_index(:assignments, [:source_paper_id]))

    create table(:assignment_questions, primary_key: false) do
      add(:id, :uuid, primary_key: true)

      add(:assignment_id, references(:assignments, type: :uuid, on_delete: :delete_all),
        null: false
      )

      # Self-referencing tree. parent_id = null marks a top-level node (a section).
      add(:parent_id, references(:assignment_questions, type: :uuid, on_delete: :delete_all))

      # 'section' | 'mcq' | 'short_answer' | 'extended_answer' | 'assertion_reason' | ...
      add(:question_type, :text, null: false)
      add(:question_number, :text)
      add(:section_label, :text)
      add(:part_label, :text)
      add(:marks_possible, :float)
      add(:sort_order, :integer, null: false, default: 0)
      add(:source_question_key, :text)
      add(:is_or_alternative, :boolean, null: false, default: false)
      add(:difficulty, :text)
      add(:short_prompt, :text)
      add(:source_type, :text)

      # Rich content. Ours (jsonb-now): the content shape itself —
      #   { question_text, expected_answer, rich_text, answer_rich_text,
      #     options: [{id, text, is_correct, has_visual}], parts: [],
      #     visual_regions: [], attempt_rule, topic, citations, tags }
      # Later this column can become an S3 pointer { bucket, filepath, version }.
      add(:body_store, :map, default: %{})

      timestamps(type: :utc_datetime)
    end

    create(index(:assignment_questions, [:assignment_id]))
    create(index(:assignment_questions, [:parent_id]))
    create(index(:assignment_questions, [:assignment_id, :sort_order]))
    create(index(:assignment_questions, [:question_type, :marks_possible]))
  end
end
