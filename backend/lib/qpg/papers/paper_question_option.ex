defmodule Qpg.Papers.PaperQuestionOption do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "paper_question_options" do
    field(:position, :integer)
    field(:label, :string)
    field(:text, :string, default: "")
    field(:rich_text, :string)
    field(:is_correct, :boolean, default: false)
    field(:payload, :map, default: %{})

    belongs_to(:paper_question, Qpg.Papers.PaperQuestion)

    timestamps(type: :utc_datetime)
  end

  def changeset(option, attrs) do
    option
    |> cast(attrs, [
      :paper_question_id,
      :position,
      :label,
      :text,
      :rich_text,
      :is_correct,
      :payload
    ])
    |> validate_required([:paper_question_id, :position])
  end
end
