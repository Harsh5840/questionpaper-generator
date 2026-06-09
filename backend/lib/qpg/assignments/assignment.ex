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
    field(:tenant_id, :string)
    field(:title, :string)
    field(:board_code, :string)
    field(:class_level, :string)
    field(:subject, :string)
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
      :tenant_id,
      :title,
      :board_code,
      :class_level,
      :subject,
      :instructions,
      :input_mode,
      :status,
      :total_marks,
      :due_date,
      :source_paper_id
    ])
    |> validate_required([:title, :status])
  end
end
