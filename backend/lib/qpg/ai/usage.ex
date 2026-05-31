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
        raw_usage: usage,
        latency_ms: Process.get(:qpg_ai_latency_ms)
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

  def record_event(provider, model, usage, operation \\ nil) do
    input_tokens = int(usage["input_tokens"] || usage["prompt_tokens"] || usage["promptTokenCount"])
    output_tokens = int(usage["output_tokens"] || usage["completion_tokens"] || usage["candidatesTokenCount"])
    total_tokens = int(usage["total_tokens"] || usage["totalTokenCount"]) || input_tokens + output_tokens

    attrs = %{
      generation_run_id: Process.get(:qpg_generation_run_id),
      paper_id: Process.get(:qpg_paper_id),
      provider: provider,
      model: model,
      operation: operation || Process.get(:qpg_ai_operation, "unknown"),
      input_tokens: input_tokens,
      output_tokens: output_tokens,
      total_tokens: total_tokens,
      estimated_cost_usd: estimate_cost(provider, model, input_tokens, output_tokens),
      metadata: %{
        raw_usage: usage,
        latency_ms: Process.get(:qpg_ai_latency_ms)
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
          provider: provider,
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
      events: Enum.map(summary.events, &serialize_event/1),
      total_latency_ms:
        summary.events
        |> Enum.map(&latency_ms/1)
        |> Enum.reject(&is_nil/1)
        |> Enum.sum()
    }
  end

  defp serialize_event(event) do
    %{
      id: event.id,
      provider: event.provider,
      model: event.model,
      operation: event.operation,
      latency_ms: latency_ms(event),
      input_tokens: event.input_tokens || 0,
      output_tokens: event.output_tokens || 0,
      total_tokens: event.total_tokens || 0,
      estimated_cost_usd: event.estimated_cost_usd |> Decimal.round(8) |> Decimal.to_float(),
      inserted_at: event.inserted_at
    }
  end

  defp latency_ms(event) do
    metadata = event.metadata || %{}
    case metadata["latency_ms"] || metadata[:latency_ms] do
      value when is_integer(value) -> value
      value when is_float(value) -> round(value)
      value when is_binary(value) ->
        case Integer.parse(value) do
          {number, _} -> number
          :error -> nil
        end
      _ -> nil
    end
  end

  defp estimate_cost(model, input_tokens, output_tokens) do
    estimate_cost("gemini", model, input_tokens, output_tokens)
  end

  defp estimate_cost(provider, model, input_tokens, output_tokens) do
    prices = pricing(model)
    prices =
      case provider do
        "groq" -> groq_pricing(model)
        _ -> prices
      end

    input_cost =
      Decimal.mult(Decimal.new(input_tokens), Decimal.new(to_string(prices.input_per_million)))

    output_cost =
      Decimal.mult(Decimal.new(output_tokens), Decimal.new(to_string(prices.output_per_million)))

    input_cost
    |> Decimal.add(output_cost)
    |> Decimal.div(Decimal.new(1_000_000))
    |> Decimal.round(8)
  end

  defp groq_pricing(model) do
    normalized = String.downcase(model || "")

    cond do
      String.contains?(normalized, "large") ->
        %{
          input_per_million: System.get_env("GROQ_LARGE_INPUT_USD_PER_1M", "0"),
          output_per_million: System.get_env("GROQ_LARGE_OUTPUT_USD_PER_1M", "0")
        }

      true ->
        %{
          input_per_million: System.get_env("GROQ_INPUT_USD_PER_1M", "0"),
          output_per_million: System.get_env("GROQ_OUTPUT_USD_PER_1M", "0")
        }
    end
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
