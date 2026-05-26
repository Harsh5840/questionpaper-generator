defmodule Qpg.QuestionBank.QuestionBankItem do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "question_bank_items" do
    field(:board, :string)
    field(:class_level, :string)
    field(:subject, :string)
    field(:chapter, :string)
    field(:topic, :string)
    field(:question_type, :string)
    field(:marks, :integer)
    field(:difficulty, :string)
    field(:source, :string)
    field(:text, :string)
    field(:rich_text, :string)
    field(:answer, :string)
    field(:answer_rich_text, :string)
    field(:tags, {:array, :string}, default: [])
    field(:payload, :map, default: %{})

    timestamps(type: :utc_datetime)
  end

  def changeset(item, attrs) do
    item
    |> cast(attrs, [
      :board,
      :class_level,
      :subject,
      :chapter,
      :topic,
      :question_type,
      :marks,
      :difficulty,
      :source,
      :text,
      :rich_text,
      :answer,
      :answer_rich_text,
      :tags,
      :payload
    ])
    |> validate_required([:text])
  end
end
