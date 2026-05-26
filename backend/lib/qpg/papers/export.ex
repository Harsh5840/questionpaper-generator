defmodule Qpg.Papers.Export do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "exports" do
    field(:format, :string)
    field(:status, :string)
    field(:file_url, :string)

    belongs_to(:paper, Qpg.Papers.Paper)
    belongs_to(:version, Qpg.Papers.PaperVersion)

    timestamps(type: :utc_datetime)
  end

  def changeset(export, attrs) do
    export
    |> cast(attrs, [:paper_id, :version_id, :format, :status, :file_url])
    |> validate_required([:paper_id, :format, :status])
    |> validate_inclusion(:format, ["pdf", "docx"])
  end
end
