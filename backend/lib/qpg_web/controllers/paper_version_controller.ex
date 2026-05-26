defmodule QpgWeb.PaperVersionController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Papers

  def create(conn, %{"id" => id, "payload" => payload} = params) do
    Logging.info("api.paper_versions.create.received", %{
      paper_id: id,
      change_source: params["change_source"] || "manual_edit",
      payload_title: payload["title"],
      has_document_html: is_binary(payload["document_html"])
    })

    paper = Papers.get_paper!(id)

    case Papers.create_version(paper, payload, params["change_source"] || "manual_edit") do
      {:ok, version} ->
        Logging.info("api.paper_versions.create.completed", %{
          paper_id: id,
          version_id: version.id,
          version_number: version.version_number
        })

        json(conn, %{
          id: version.id,
          version_number: version.version_number,
          payload: version.payload
        })

      {:error, changeset} ->
        Logging.error("api.paper_versions.create.failed", %{
          paper_id: id,
          errors: changeset.errors
        })

        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(changeset.errors)})
    end
  end
end
