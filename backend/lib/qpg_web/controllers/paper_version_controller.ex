defmodule QpgWeb.PaperVersionController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Assignments
  alias Qpg.Logging

  # Save edits. In the prod-aligned model there is no version table — this
  # persists the edited payload onto the assignment (rebuilding its question
  # tree) and echoes back a synthetic version envelope the UI expects.
  def create(conn, %{"id" => id, "payload" => payload} = params) do
    Logging.info("api.paper_versions.create.received", %{
      paper_id: id,
      change_source: params["change_source"] || "manual_edit",
      payload_title: payload["title"],
      has_document_html: is_binary(payload["document_html"])
    })

    opts = [prefix: QpgWeb.Tenancy.prefix(conn)]
    assignment = Assignments.get_assignment!(id, opts)

    case Assignments.save_payload(assignment, payload, params["change_source"] || "manual_edit", opts) do
      {:ok, saved} ->
        Logging.info("api.paper_versions.create.completed", %{paper_id: id})

        json(conn, %{
          id: saved.id,
          version_number: 1,
          marks_total: saved.total_marks,
          payload: Assignments.rebuild_payload(saved, opts)
        })

      {:error, reason} ->
        Logging.error("api.paper_versions.create.failed", %{paper_id: id, error: inspect(reason)})
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
    end
  end
end
