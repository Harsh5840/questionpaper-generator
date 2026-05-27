defmodule Qpg.Papers.PaperQuestion do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "paper_questions" do
    field(:question_key, :string)
    field(:position, :integer)
    field(:question_number, :string)
    field(:part_label, :string)
    field(:relation_type, :string, default: "root")
    field(:choice_group, :string)
    field(:question_type, :string)
    field(:marks, :integer, default: 0)
    field(:difficulty, :string)
    field(:source, :string)
    field(:topic, :string)
    field(:text, :string, default: "")
    field(:rich_text, :string)
    field(:answer, :string)
    field(:answer_rich_text, :string)
    field(:source_citations, {:array, :string}, default: [])
    field(:tags, {:array, :string}, default: [])
    field(:payload, :map, default: %{})

    belongs_to(:paper, Qpg.Papers.Paper)
    belongs_to(:paper_version, Qpg.Papers.PaperVersion)
    belongs_to(:paper_section, Qpg.Papers.PaperSection)
    belongs_to(:parent_question, __MODULE__)
    has_many(:child_questions, __MODULE__, foreign_key: :parent_question_id)
    has_many(:options, Qpg.Papers.PaperQuestionOption)

    timestamps(type: :utc_datetime)
  end

  def changeset(question, attrs) do
    question
    |> cast(attrs, [
      :paper_id,
      :paper_version_id,
      :paper_section_id,
      :parent_question_id,
      :question_key,
      :position,
      :question_number,
      :part_label,
      :relation_type,
      :choice_group,
      :question_type,
      :marks,
      :difficulty,
      :source,
      :topic,
      :text,
      :rich_text,
      :answer,
      :answer_rich_text,
      :source_citations,
      :tags,
      :payload
    ])
    |> validate_required([
      :paper_id,
      :paper_version_id,
      :paper_section_id,
      :position,
      :question_number,
      :relation_type
    ])
  end
end
