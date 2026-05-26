defmodule Qpg.Papers.Paper do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "papers" do
    field(:title, :string)
    field(:board, :string)
    field(:class_level, :string)
    field(:subject, :string)
    field(:status, :string, default: "draft")
    field(:source_mode, :string)

    has_many(:versions, Qpg.Papers.PaperVersion)

    timestamps(type: :utc_datetime)
  end

  def changeset(paper, attrs) do
    paper
    |> cast(attrs, [:title, :board, :class_level, :subject, :status, :source_mode])
    |> validate_required([:title, :board, :class_level, :subject, :status])
  end
end
