defmodule QpgWeb.PaperController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Papers

  def index(conn, _params) do
    papers = Enum.map(Papers.list_papers(), &serialize/1)
    Logging.info("api.papers.index.completed", %{count: length(papers)})
    json(conn, %{papers: papers})
  end

  def show(conn, %{"id" => id}) do
    paper = Papers.get_paper!(id)

    Logging.info("api.papers.show.completed", %{
      paper_id: id,
      version_count: paper.versions |> List.wrap() |> length()
    })

    json(conn, serialize(paper))
  end

  def structured(conn, %{"id" => id}) do
    %{paper: paper, version: version, payload: payload} = Papers.get_structured_paper!(id)

    Logging.info("api.papers.structured.completed", %{
      paper_id: id,
      version_id: version && version.id
    })

    json(conn, %{
      id: paper.id,
      title: paper.title,
      version: version && serialize_version(version),
      payload: payload
    })
  end

  def delete(conn, %{"id" => id}) do
    paper = Papers.get_paper!(id)
    {:ok, _} = Papers.delete_paper(paper)
    Logging.warning("api.papers.delete.completed", %{paper_id: id})
    send_resp(conn, :no_content, "")
  end

  defp serialize(paper) do
    %{
      id: paper.id,
      title: paper.title,
      board: paper.board,
      class_level: paper.class_level,
      subject: paper.subject,
      status: paper.status,
      versions: Enum.map(paper.versions || [], &serialize_version/1),
      updated_at: paper.updated_at
    }
  end

  defp serialize_version(version) do
    %{
      id: version.id,
      version_number: version.version_number,
      change_source: version.change_source,
      payload: version.payload,
      marks_total: version.marks_total,
      inserted_at: version.inserted_at
    }
  end
end
