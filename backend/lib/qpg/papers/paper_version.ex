defmodule Qpg.Papers.PaperVersion do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "paper_versions" do
    field(:version_number, :integer)
    field(:change_source, :string)
    field(:payload, :map)
    field(:marks_total, :integer)

    belongs_to(:paper, Qpg.Papers.Paper)
    has_many(:sections, Qpg.Papers.PaperSection)
    has_many(:questions, Qpg.Papers.PaperQuestion)

    timestamps(type: :utc_datetime)
  end

  def changeset(version, attrs) do
    version
    |> cast(attrs, [:paper_id, :version_number, :change_source, :payload, :marks_total])
    |> validate_required([:paper_id, :version_number, :change_source, :payload])
  end
end
