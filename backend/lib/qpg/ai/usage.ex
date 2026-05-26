defmodule Qpg.AI.Usage do
  import Ecto.Query

  alias Qpg.AI.UsageEvent
  alias Qpg.Logging
  alias Qpg.Repo

  def record_gemini_event(model, response, operation \\ nil) do
    usage = Map.get(response, "usageMetadata", %{})
    input_tokens = int(usage["promptTokenCount"])
    output_tokens = int(usage["candidatesTokenCount"])
    total_tokens = int(usage["totalTokenCount"]) || input_tokens + output_tokens

    attrs = %{
      generation_run_id: Process.get(:qpg_generation_run_id),
      paper_id: Process.get(:qpg_paper_id),
      provider: "gemini",
      model: model,
      operation: operation || Process.get(:qpg_ai_operation, "unknown"),
      input_tokens: input_tokens,
      output_tokens: output_tokens,
      total_tokens: total_tokens,
      estimated_cost_usd: estimate_cost(model, input_tokens, output_tokens),
      metadata: %{
        raw_usage: usage
      }
    }

    %UsageEvent{}
    |> UsageEvent.changeset(attrs)
    |> Repo.insert()
    |> tap(fn
      {:ok, event} ->
        Logging.info("ai.usage.recorded", %{
          id: event.id,
          generation_run_id: event.generation_run_id,
          model: model,
          operation: attrs.operation,
          total_tokens: total_tokens,
          estimated_cost_usd: Decimal.to_string(event.estimated_cost_usd)
        })

      {:error, changeset} ->
        Logging.error("ai.usage.record_failed", %{errors: changeset.errors})
    end)
  rescue
    error ->
      Logging.error("ai.usage.record_exception", %{error: Exception.message(error)})
      {:error, error}
  end

  def summarize_for_run(run_id) do
    events =
      UsageEvent
      |> where([event], event.generation_run_id == ^run_id)
      |> order_by([event], asc: event.inserted_at)
      |> Repo.all()

    totals =
      Enum.reduce(
        events,
        %{
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: Decimal.new("0")
        },
        fn event, acc ->
          %{
            input_tokens: acc.input_tokens + (event.input_tokens || 0),
            output_tokens: acc.output_tokens + (event.output_tokens || 0),
            total_tokens: acc.total_tokens + (event.total_tokens || 0),
            estimated_cost_usd:
              Decimal.add(acc.estimated_cost_usd, event.estimated_cost_usd || Decimal.new("0"))
          }
        end
      )

    Map.put(totals, :events, events)
  end

  def serialize_summary(summary) do
    %{
      input_tokens: summary.input_tokens,
      output_tokens: summary.output_tokens,
      total_tokens: summary.total_tokens,
      estimated_cost_usd: summary.estimated_cost_usd |> Decimal.round(8) |> Decimal.to_float(),
      events: Enum.map(summary.events, &serialize_event/1)
    }
  end

  defp serialize_event(event) do
    %{
      id: event.id,
      model: event.model,
      operation: event.operation,
      input_tokens: event.input_tokens || 0,
      output_tokens: event.output_tokens || 0,
      total_tokens: event.total_tokens || 0,
      estimated_cost_usd: event.estimated_cost_usd |> Decimal.round(8) |> Decimal.to_float(),
      inserted_at: event.inserted_at
    }
  end

  defp estimate_cost(model, input_tokens, output_tokens) do
    prices = pricing(model)

    input_cost =
      Decimal.mult(Decimal.new(input_tokens), Decimal.new(to_string(prices.input_per_million)))

    output_cost =
      Decimal.mult(Decimal.new(output_tokens), Decimal.new(to_string(prices.output_per_million)))

    input_cost
    |> Decimal.add(output_cost)
    |> Decimal.div(Decimal.new(1_000_000))
    |> Decimal.round(8)
  end

  defp pricing(model) do
    cond do
      String.contains?(model, "pro") ->
        %{
          input_per_million: System.get_env("GEMINI_PRO_INPUT_USD_PER_1M", "1.25"),
          output_per_million: System.get_env("GEMINI_PRO_OUTPUT_USD_PER_1M", "10.00")
        }

      true ->
        %{
          input_per_million: System.get_env("GEMINI_FLASH_INPUT_USD_PER_1M", "0.30"),
          output_per_million: System.get_env("GEMINI_FLASH_OUTPUT_USD_PER_1M", "2.50")
        }
    end
  end

  defp int(nil), do: 0
  defp int(value) when is_integer(value), do: value
  defp int(value) when is_binary(value), do: String.to_integer(value)
  defp int(_), do: 0
end
