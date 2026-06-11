defmodule Qpg.Assignments.Assignment do
  @moduledoc """
  A question paper in the prod-aligned model — the identity + rules.
  The whole body lives as a tree of `Qpg.Assignments.AssignmentQuestion` rows.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "assignments" do
    field(:created_by, Ecto.UUID)
    field(:title, :string)
    field(:board_code, :string)
    field(:class_level, :string)
    field(:subject, :string)
    # Real FKs to the main app's class/subject records. The `class_level`/
    # `subject` text columns stay for our own display + rebuild.
    field(:class_id, Ecto.UUID)
    field(:subject_id, Ecto.UUID)
    field(:instructions, :string)
    field(:input_mode, :string)
    field(:status, :string, default: "draft")
    field(:total_marks, :integer, default: 0)
    field(:due_date, :utc_datetime)
    field(:source_paper_id, Ecto.UUID)

    has_many(:questions, Qpg.Assignments.AssignmentQuestion)

    timestamps(type: :utc_datetime)
  end

  def changeset(assignment, attrs) do
    assignment
    |> cast(attrs, [
      :created_by,
      :title,
      :board_code,
      :class_level,
      :subject,
      :class_id,
      :subject_id,
      :instructions,
      :input_mode,
      :status,
      :total_marks,
      :due_date,
      :source_paper_id
    ])
    |> validate_required([:created_by, :title, :status])
  end
end
