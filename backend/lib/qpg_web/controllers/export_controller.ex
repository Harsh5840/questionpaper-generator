defmodule QpgWeb.ExportController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Assignments
  alias Qpg.Logging

  def create(conn, %{"id" => id} = params) do
    Logging.info("api.exports.create.received", %{
      paper_id: id,
      format: params["format"] || "pdf"
    })

    opts = [prefix: QpgWeb.Tenancy.prefix(conn)]
    assignment = Assignments.get_assignment!(id, opts)

    case Assignments.create_export(assignment, params, opts) do
      {:ok, export} ->
        Logging.info("api.exports.create.completed", %{
          paper_id: id,
          export_id: export.id,
          status: export.status
        })

        json(conn, %{id: export.id, status: export.status, format: export.format})

      {:error, changeset} ->
        Logging.error("api.exports.create.failed", %{paper_id: id, errors: changeset.errors})
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(changeset.errors)})
    end
  end
end
