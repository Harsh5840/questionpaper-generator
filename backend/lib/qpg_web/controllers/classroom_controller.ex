defmodule QpgWeb.ClassroomController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Integrations.GoogleClassroom
  alias Qpg.Logging
  alias Qpg.Papers

  def create(conn, %{"id" => id} = params) do
    Logging.info("api.classroom.create.received", %{
      paper_id: id,
      course_id: params["course_id"],
      has_attachment: params["attachment_url"] not in [nil, ""]
    })

    paper = Papers.get_paper!(id)

    attrs =
      params
      |> Map.put_new("title", paper.title)
      |> Map.put_new(
        "description",
        "#{paper.board} Class #{paper.class_level} #{paper.subject} question paper"
      )

    case GoogleClassroom.create_material(attrs) do
      {:ok, result} ->
        Logging.info("api.classroom.create.completed", %{
          paper_id: id,
          status: result[:status] || result["status"]
        })

        json(conn, result)

      {:error, error} ->
        Logging.error("api.classroom.create.failed", %{paper_id: id, error: error})

        conn
        |> put_status(:bad_gateway)
        |> json(%{error: error})
    end
  end
end
