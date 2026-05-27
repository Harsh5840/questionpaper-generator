defmodule Qpg.Papers.PaperSection do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "paper_sections" do
    field(:section_key, :string)
    field(:position, :integer)
    field(:title, :string)
    field(:instructions, :string)
    field(:difficulty, :string)
    field(:target_marks, :integer)
    field(:payload, :map, default: %{})

    belongs_to(:paper, Qpg.Papers.Paper)
    belongs_to(:paper_version, Qpg.Papers.PaperVersion)
    has_many(:questions, Qpg.Papers.PaperQuestion)

    timestamps(type: :utc_datetime)
  end

  def changeset(section, attrs) do
    section
    |> cast(attrs, [
      :paper_id,
      :paper_version_id,
      :section_key,
      :position,
      :title,
      :instructions,
      :difficulty,
      :target_marks,
      :payload
    ])
    |> validate_required([:paper_id, :paper_version_id, :position, :title])
  end
end
