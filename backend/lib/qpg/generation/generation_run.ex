defmodule Qpg.Generation.GenerationRun do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "generation_runs" do
    field(:mode, :string)
    field(:request, :map)
    field(:status, :string)
    field(:variants, {:array, :map}, default: [])
    field(:warnings, {:array, :string}, default: [])
    field(:tool_trace, {:array, :map}, default: [])
    field(:paper_ids, {:array, Ecto.UUID}, default: [])

    timestamps(type: :utc_datetime)
  end

  def changeset(run, attrs) do
    run
    |> cast(attrs, [:mode, :request, :status, :variants, :warnings, :tool_trace, :paper_ids])
    |> validate_required([:mode, :request, :status])
  end
end
