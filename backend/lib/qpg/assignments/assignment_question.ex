defmodule Qpg.Assignments.AssignmentQuestion do
  @moduledoc """
  One node of a paper's tree: a section, question, sub-part or OR-alternative.
  Linked to its parent via `parent_id` (null = section / top level).
  Queryable metadata is in columns; rich text + options live in `body_store`.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "assignment_questions" do
    field(:question_type, :string)
    field(:question_number, :integer)
    field(:section_label, :string)
    field(:part_label, :string)
    field(:marks_possible, :float)
    field(:sort_order, :integer, default: 0)
    field(:source_question_key, :string)
    field(:is_or_alternative, :boolean, default: false)
    field(:difficulty, :string)
    field(:short_prompt, :string)
    field(:source_type, :string)
    # Link back to the corpus question this was pulled from (null for AI/manual).
    field(:content_question_id, Ecto.UUID)
    field(:body_store, :map, default: %{})

    belongs_to(:assignment, Qpg.Assignments.Assignment)
    belongs_to(:parent, __MODULE__)
    has_many(:children, __MODULE__, foreign_key: :parent_id)

    timestamps(type: :utc_datetime)
  end

  def changeset(question, attrs) do
    question
    |> cast(attrs, [
      :assignment_id,
      :parent_id,
      :question_type,
      :question_number,
      :section_label,
      :part_label,
      :marks_possible,
      :sort_order,
      :source_question_key,
      :is_or_alternative,
      :difficulty,
      :short_prompt,
      :source_type,
      :content_question_id,
      :body_store
    ])
    |> validate_required([:assignment_id, :question_type, :sort_order])
  end
end
