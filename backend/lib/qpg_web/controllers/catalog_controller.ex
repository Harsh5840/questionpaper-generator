defmodule QpgWeb.CatalogController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Sources

  def chapters(conn, params) do
    chapters = Sources.list_chapters(params)

    Logging.info("api.catalog.chapters.completed", %{
      params: params,
      chapter_count: length(chapters)
    })

    json(conn, %{chapters: chapters})
  end
end
