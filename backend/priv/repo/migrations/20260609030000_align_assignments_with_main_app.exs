defmodule Qpg.Repo.Migrations.AlignAssignmentsWithMainApp do
  use Ecto.Migration

  # Align the rows we write with what the main product expects so they merge
  # without rework:
  #   * created_by        — the teacher who made the assignment (required there).
  #   * class_id/subject_id — real FKs to school_classes / subjects (not names).
  #   * content_question_id — link a corpus-pulled question back to its source.
  #   * tenant_id dropped — tenancy is per-schema (a `prefix:` on every call),
  #     not a column on a shared table.

  def change do
    alter table(:assignments) do
      add(:created_by, :binary_id)
      add(:class_id, :binary_id)
      add(:subject_id, :binary_id)
      remove(:tenant_id, :text)
    end

    alter table(:assignment_questions) do
      add(:content_question_id, :binary_id)
    end

    # tenant_id's index is dropped automatically with the column.
    create(index(:assignments, [:created_by]))
    create(index(:assignments, [:class_id]))
    create(index(:assignments, [:subject_id]))
    create(index(:assignment_questions, [:content_question_id]))
  end
end
