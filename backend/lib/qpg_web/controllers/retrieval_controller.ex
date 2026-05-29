defmodule QpgWeb.RetrievalController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Sources

  def preview(conn, params) do
    filters = normalize_params(params)

    Logging.info("api.retrieval.preview.received", %{
      filters:
        Map.take(filters, [
          "board",
          "class_level",
          "subject",
          "chapter_scope",
          "chapter",
          "chapters",
          "topic"
        ])
    })

    json(conn, Sources.retrieval_preview(filters))
  end

  defp normalize_params(params) do
    chapters =
      params
      |> Map.get("chapters", Map.get(params, "chapters[]", []))
      |> List.wrap()
      |> Enum.map(&to_string/1)
      |> Enum.reject(&(&1 == ""))

    source_books =
      params
      |> Map.get("source_books", Map.get(params, "source_books[]", []))
      |> List.wrap()
      |> Enum.map(&to_string/1)
      |> Enum.reject(&(&1 == ""))

    source_categories =
      params
      |> Map.get("source_categories", Map.get(params, "source_categories[]", []))
      |> List.wrap()
      |> Enum.map(&to_string/1)
      |> Enum.reject(&(&1 == ""))

    params
    |> Map.put("chapters", chapters)
    |> Map.put("source_books", source_books)
    |> Map.put("source_categories", source_categories)
    |> Map.take([
      "board",
      "class_level",
      "subject",
      "subject_focus",
      "chapter",
      "chapter_scope",
      "chapters",
      "topic",
      "source",
      "source_books",
      "source_categories",
      "difficulty",
      "total_marks"
    ])
  end
end
