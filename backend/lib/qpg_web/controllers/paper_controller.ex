defmodule QpgWeb.PaperController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Assignments
  alias Qpg.Logging

  def index(conn, _params) do
    papers = Enum.map(Assignments.list(), &serialize_summary/1)
    Logging.info("api.papers.index.completed", %{count: length(papers)})
    json(conn, %{papers: papers})
  end

  def show(conn, %{"id" => id}) do
    assignment = Assignments.get_assignment!(id)
    payload = Assignments.rebuild_payload(assignment)

    Logging.info("api.papers.show.completed", %{paper_id: id})
    json(conn, serialize(assignment, payload))
  end

  def structured(conn, %{"id" => id}) do
    %{assignment: assignment, payload: payload} = Assignments.structured(id) || not_found!(id)

    Logging.info("api.papers.structured.completed", %{
      paper_id: id,
      section_count: payload |> Map.get("sections", []) |> List.wrap() |> length()
    })

    json(conn, %{
      id: assignment.id,
      title: assignment.title,
      version: serialize_version(assignment, payload),
      payload: payload
    })
  end

  def delete(conn, %{"id" => id}) do
    assignment = Assignments.get_assignment!(id)
    {:ok, _} = Assignments.delete_assignment(assignment)
    Logging.warning("api.papers.delete.completed", %{paper_id: id})
    send_resp(conn, :no_content, "")
  end

  # The prod model has no version table; the assignment row IS the current
  # state. We surface a single synthetic "version" so the existing UI contract
  # (papers carry a versions array, structured returns a version) keeps working.
  defp serialize(assignment, payload) do
    %{
      id: assignment.id,
      title: assignment.title,
      board: assignment.board_code,
      class_level: assignment.class_level,
      subject: assignment.subject,
      status: assignment.status,
      versions: [serialize_version(assignment, payload)],
      updated_at: assignment.updated_at
    }
  end

  # Cheap list serialization — no per-row tree rebuild.
  defp serialize_summary(assignment) do
    %{
      id: assignment.id,
      title: assignment.title,
      board: assignment.board_code,
      class_level: assignment.class_level,
      subject: assignment.subject,
      status: assignment.status,
      versions: [serialize_version(assignment, %{})],
      updated_at: assignment.updated_at
    }
  end

  defp serialize_version(assignment, payload) do
    %{
      id: assignment.id,
      version_number: 1,
      change_source: "current",
      payload: payload,
      marks_total: assignment.total_marks,
      inserted_at: assignment.updated_at
    }
  end

  defp not_found!(id), do: raise(Ecto.NoResultsError, queryable: "assignments id=#{id}")
end
