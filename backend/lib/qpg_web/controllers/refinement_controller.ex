defmodule QpgWeb.RefinementController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.AI.Orchestrator
  alias Qpg.Logging
  alias Qpg.Papers

  def create(conn, %{"id" => id, "instruction" => instruction}) do
    Logging.info("api.refinements.create.received", %{paper_id: id, instruction: instruction})

    paper = Papers.get_paper!(id)
    Process.put(:qpg_paper_id, paper.id)
    Process.put(:qpg_ai_operation, "refinement")

    response =
      try do
        Orchestrator.refine(paper, instruction)
      after
        Process.delete(:qpg_paper_id)
        Process.delete(:qpg_ai_operation)
      end

    Logging.info("api.refinements.create.completed", %{
      paper_id: id,
      patch_count: response |> Map.get("patch_ops", []) |> length()
    })

    json(conn, response)
  end
end
