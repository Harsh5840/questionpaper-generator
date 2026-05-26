defmodule QpgWeb.QuestionImportController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.AI.Provider
  alias Qpg.Logging
  alias Qpg.Sources

  def source(conn, %{"source_type" => source_type, "id" => id} = params) do
    request = params["request"] || %{}

    Logging.info("api.questions.import_source.received", %{
      source_type: source_type,
      id: id,
      request: Map.take(request, ["board", "class_level", "subject", "chapter", "topic"])
    })

    case Sources.import_question_from_source(source_type, id, request) do
      {:ok, question} ->
        json(conn, %{question: question})

      {:error, reason} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
    end
  end

  def image(conn, %{"image_base64" => image_base64, "mime_type" => mime_type} = params) do
    request = params["request"] || %{}

    Logging.info("api.questions.import_image.received", %{
      file_name: params["file_name"],
      mime_type: mime_type,
      request: Map.take(request, ["board", "class_level", "subject", "chapter", "topic"])
    })

    if not Provider.enabled?() do
      conn |> put_status(:unprocessable_entity) |> json(%{error: "AI provider is not configured"})
    else
      case Provider.extract_question_from_image(image_base64, mime_type, request) do
        {:ok, question} ->
          json(conn, %{question: question})

        {:error, reason} ->
          conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
      end
    end
  end
end
