defmodule Qpg.Papers.Export do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "exports" do
    field(:format, :string)
    field(:status, :string)
    field(:file_url, :string)

    # Re-pointed to the prod-aligned assignments table in the Phase 2 cutover.
    # (Column stays named `paper_id`.) Versions no longer exist as a table.
    belongs_to(:paper, Qpg.Assignments.Assignment)

    timestamps(type: :utc_datetime)
  end

  def changeset(export, attrs) do
    export
    |> cast(attrs, [:paper_id, :format, :status, :file_url])
    |> validate_required([:paper_id, :format, :status])
    |> validate_inclusion(:format, ["pdf", "docx"])
  end
end
