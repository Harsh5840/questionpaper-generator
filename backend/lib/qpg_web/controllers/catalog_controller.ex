defmodule QpgWeb.CatalogController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Sources

  def subjects(conn, params) do
    subjects = Sources.list_subjects(params)

    Logging.info("api.catalog.subjects.completed", %{
      params: params,
      subject_count: length(subjects)
    })

    json(conn, %{subjects: subjects})
  end

  def chapters(conn, params) do
    chapters = Sources.list_chapters(params)

    Logging.info("api.catalog.chapters.completed", %{
      params: params,
      chapter_count: length(chapters)
    })

    json(conn, %{chapters: chapters})
  end
end
