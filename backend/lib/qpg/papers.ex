defmodule Qpg.Papers do
  import Ecto.Query

  alias Qpg.Logging
  alias Qpg.Repo
  alias Qpg.Papers.{Export, Paper, PaperVersion}

  def list_papers do
    papers =
      Paper
      |> order_by([p], desc: p.updated_at)
      |> preload(:versions)
      |> Repo.all()

    Logging.info("papers.list.completed", %{count: length(papers)})
    papers
  end

  def get_paper!(id) do
    paper =
      Paper
      |> preload(versions: ^from(v in PaperVersion, order_by: [desc: v.version_number]))
      |> Repo.get!(id)

    Logging.info("papers.get.completed", %{
      paper_id: id,
      version_count: paper |> Map.get(:versions, []) |> length()
    })

    paper
  end

  def create_paper_from_variant(variant, request, source) do
    Logging.info("papers.create_from_variant.started", %{
      variant_id: variant["id"],
      title: variant["title"],
      source_mode: source,
      request:
        Map.take(request, ["board", "class_level", "subject", "total_marks", "variant_count"])
    })

    Repo.transaction(fn ->
      {:ok, paper} =
        %Paper{}
        |> Paper.changeset(%{
          title: variant["title"] || "Generated Question Paper",
          board: request["board"],
          class_level: request["class_level"],
          subject: request["subject"],
          status: "draft",
          source_mode: source
        })
        |> Repo.insert()

      {:ok, version} = create_version(paper, variant, "ai_generation")

      Logging.info("papers.create_from_variant.completed", %{
        paper_id: paper.id,
        version_id: version.id,
        marks_total: version.marks_total
      })

      %{paper | versions: [version]}
    end)
  end

  def create_version(%Paper{} = paper, payload, change_source) do
    # Every accepted AI edit and manual editor save becomes a new immutable
    # version. These logs let us trace whether the UI save button actually
    # reached the backend and what version number was assigned.
    Logging.info("papers.version.create.started", %{
      paper_id: paper.id,
      change_source: change_source,
      payload_summary: payload_summary(payload)
    })

    next_version =
      PaperVersion
      |> where([v], v.paper_id == ^paper.id)
      |> select([v], max(v.version_number))
      |> Repo.one()
      |> case do
        nil -> 1
        number -> number + 1
      end

    %PaperVersion{}
    |> PaperVersion.changeset(%{
      paper_id: paper.id,
      version_number: next_version,
      change_source: change_source,
      payload: payload,
      marks_total: get_in(payload, ["summary", "total_marks"]) || payload["total_marks"]
    })
    |> Repo.insert()
    |> tap(fn
      {:ok, version} ->
        Logging.info("papers.version.create.completed", %{
          paper_id: paper.id,
          version_id: version.id,
          version_number: version.version_number,
          marks_total: version.marks_total
        })

      {:error, changeset} ->
        Logging.error("papers.version.create.failed", %{
          paper_id: paper.id,
          errors: changeset.errors
        })
    end)
  end

  def delete_paper(%Paper{} = paper) do
    Logging.warning("papers.delete.started", %{paper_id: paper.id, title: paper.title})
    Repo.delete(paper)
  end

  def create_export(%Paper{} = paper, attrs) do
    Logging.info("papers.export.create.started", %{
      paper_id: paper.id,
      version_id: attrs["version_id"],
      format: attrs["format"] || "pdf"
    })

    %Export{}
    |> Export.changeset(%{
      paper_id: paper.id,
      version_id: attrs["version_id"],
      format: attrs["format"] || "pdf",
      status: "queued"
    })
    |> Repo.insert()
    |> tap(fn
      {:ok, export} ->
        Logging.info("papers.export.create.completed", %{
          paper_id: paper.id,
          export_id: export.id,
          format: export.format,
          status: export.status
        })

      {:error, changeset} ->
        Logging.error("papers.export.create.failed", %{
          paper_id: paper.id,
          errors: changeset.errors
        })
    end)
  end

  defp payload_summary(payload) when is_map(payload) do
    %{
      title: payload["title"],
      total_marks: get_in(payload, ["summary", "total_marks"]) || payload["total_marks"],
      section_count: payload |> Map.get("sections", []) |> List.wrap() |> length(),
      warning_count: payload |> Map.get("warnings", []) |> List.wrap() |> length(),
      has_document_html: is_binary(payload["document_html"])
    }
  end

  defp payload_summary(_payload), do: %{payload: "non-map"}
end
