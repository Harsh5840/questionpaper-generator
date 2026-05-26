defmodule Qpg.AI.UsageEvent do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "ai_usage_events" do
    field(:provider, :string, default: "gemini")
    field(:model, :string)
    field(:operation, :string)
    field(:input_tokens, :integer, default: 0)
    field(:output_tokens, :integer, default: 0)
    field(:total_tokens, :integer, default: 0)
    field(:estimated_cost_usd, :decimal, default: Decimal.new("0"))
    field(:metadata, :map, default: %{})

    belongs_to(:generation_run, Qpg.Generation.GenerationRun)
    belongs_to(:paper, Qpg.Papers.Paper)

    timestamps(type: :utc_datetime)
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [
      :generation_run_id,
      :paper_id,
      :provider,
      :model,
      :operation,
      :input_tokens,
      :output_tokens,
      :total_tokens,
      :estimated_cost_usd,
      :metadata
    ])
    |> validate_required([:provider, :model, :operation])
  end
end
