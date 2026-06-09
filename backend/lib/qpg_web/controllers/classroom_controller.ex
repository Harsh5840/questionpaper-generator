defmodule QpgWeb.ClassroomController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Assignments
  alias Qpg.Integrations.GoogleClassroom
  alias Qpg.Logging

  def create(conn, %{"id" => id} = params) do
    Logging.info("api.classroom.create.received", %{
      paper_id: id,
      course_id: params["course_id"],
      has_attachment: params["attachment_url"] not in [nil, ""]
    })

    assignment = Assignments.get_assignment!(id)

    attrs =
      params
      |> Map.put_new("title", assignment.title)
      |> Map.put_new(
        "description",
        "#{assignment.board_code} Class #{assignment.class_level} #{assignment.subject} question paper"
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
