defmodule QpgWeb.ExportController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Papers

  def create(conn, %{"id" => id} = params) do
    Logging.info("api.exports.create.received", %{
      paper_id: id,
      version_id: params["version_id"],
      format: params["format"] || "pdf"
    })

    paper = Papers.get_paper!(id)

    case Papers.create_export(paper, params) do
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
