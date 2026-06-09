defmodule QpgWeb.RefinementController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.AI.Orchestrator
  alias Qpg.Assignments
  alias Qpg.Logging

  def create(conn, %{"id" => id, "instruction" => instruction} = params) do
    Logging.info("api.refinements.create.received", %{paper_id: id, instruction: instruction})

    assignment = Assignments.get_assignment!(id)
    paper_payload = params["paper"] || Assignments.rebuild_payload(assignment)
    Process.put(:qpg_paper_id, assignment.id)
    Process.put(:qpg_ai_operation, "refinement")

    response =
      try do
        Orchestrator.refine_payload(paper_payload, instruction, assignment.id)
      rescue
        exception ->
          Logging.error("api.refinements.create.exception", %{
            paper_id: id,
            instruction: instruction,
            reason: Exception.message(exception)
          })

          %{
            "message" => "",
            "patch_ops" => [],
            "preview" => paper_payload,
            "base_version_id" => ""
          }
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
