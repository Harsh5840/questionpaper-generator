defmodule QpgWeb.GenerationRunController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Generation
  alias Qpg.AI.Usage
  alias Qpg.Logging

  def create(conn, params) do
    Logging.info("api.generation_runs.create.received", %{
      mode: params["mode"],
      has_free_prompt: params["free_prompt"] not in [nil, ""],
      parameter_keys: params |> Map.get("parameters", %{}) |> Map.keys()
    })

    case Generation.create_run(params) do
      {:ok, run} ->
        Logging.info("api.generation_runs.create.completed", %{run_id: run.id, status: run.status})

        json(conn, serialize(run))

      {:error, error} ->
        Logging.error("api.generation_runs.create.failed", %{error: error})
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(error)})
    end
  end

  def show(conn, %{"id" => id}) do
    run = Generation.get_run!(id)
    Logging.debug("api.generation_runs.show.completed", %{run_id: id, status: run.status})
    json(conn, serialize(run))
  end

  def usage(conn, %{"id" => id}) do
    summary = id |> Usage.summarize_for_run() |> Usage.serialize_summary()

    Logging.info("api.generation_runs.usage.completed", %{
      run_id: id,
      total_tokens: summary.total_tokens
    })

    json(conn, summary)
  end

  defp serialize(run), do: Generation.serialize(run)
end
