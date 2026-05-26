defmodule Qpg.AI.Orchestrator do
  alias Qpg.AI.Provider
  alias Qpg.Logging

  def generate(request) do
    Logging.info("ai.orchestrator.generate.started", %{
      provider: inspect(Provider.active()),
      request: request_summary(request)
    })

    case safe_generate_bundle(request) do
      {:ok, %{"variants" => _} = bundle} ->
        Logging.info("ai.orchestrator.generate.completed", %{
          variant_count: bundle |> Map.get("variants", []) |> length(),
          warning_count: bundle |> Map.get("warnings", []) |> length()
        })

        bundle

      {:error, reason} ->
        Logging.error("ai.orchestrator.generate.failed", %{reason: reason})
        raise "AI provider failed: #{format_error(reason)}"
    end
  end

  def refine(paper, instruction) do
    serializable_paper = serialize_paper(paper)

    Logging.info("ai.orchestrator.refine.started", %{
      provider: inspect(Provider.active()),
      paper_id: paper.id,
      instruction: instruction
    })

    case safe_refine_bundle(serializable_paper, instruction) do
      {:ok, %{"patch_ops" => _} = response} ->
        Logging.info("ai.orchestrator.refine.completed", %{
          paper_id: paper.id,
          patch_count: response |> Map.get("patch_ops", []) |> length()
        })

        response

      {:error, reason} ->
        Logging.error("ai.orchestrator.refine.failed", %{paper_id: paper.id, reason: reason})
        raise "AI refinement failed: #{format_error(reason)}"
    end
  end

  def apply_patch_preview(payload, patch_ops) do
    # This preview is intentionally small in v1. Logs make it clear when an AI
    # patch was ignored because we have not implemented that operation yet.
    Logging.info("ai.orchestrator.patch_preview.started", %{
      patch_count: length(patch_ops),
      operations: Enum.map(patch_ops, &Map.take(&1, [:op, "op", :path, "path"]))
    })

    Enum.reduce(patch_ops, payload, fn op, acc ->
      case op do
        %{op: "replace", path: "/summary/difficulty", value: value} ->
          put_in(acc, ["summary", "difficulty"], value)

        %{op: "replace", path: "/sections/0/questions/0/text", value: value} ->
          put_in(acc, ["sections", Access.at(0), "questions", Access.at(0), "text"], value)

        %{op: "add", path: "/warnings/-", value: value} ->
          Map.update(acc, "warnings", [value], &(&1 ++ [value]))

        _ ->
          acc
      end
    end)
  end

  defp serialize_paper(%{versions: versions} = paper) do
    serialized_versions =
      versions
      |> List.wrap()
      |> Enum.map(fn version ->
        %{
          id: version.id,
          version_number: version.version_number,
          change_source: version.change_source,
          payload: version.payload,
          marks_total: version.marks_total
        }
      end)

    %{
      id: paper.id,
      title: paper.title,
      board: paper.board,
      class_level: paper.class_level,
      subject: paper.subject,
      status: paper.status,
      source_mode: paper.source_mode,
      versions: serialized_versions
    }
  end

  defp safe_generate_bundle(request) do
    Provider.generate_bundle(request)
  rescue
    exception -> {:error, {:exception, Exception.message(exception)}}
  end

  defp safe_refine_bundle(paper, instruction) do
    Provider.refine_bundle(paper, instruction)
  rescue
    exception -> {:error, {:exception, Exception.message(exception)}}
  end

  defp format_error({:exception, message}), do: message
  defp format_error(%{status: status, body: body}), do: "HTTP #{status} #{inspect(body)}"
  defp format_error(%{status: status}), do: "HTTP #{status}"
  defp format_error(reason), do: inspect(reason)

  defp request_summary(request) do
    Map.take(request, [
      "board",
      "class_level",
      "subject",
      "chapter_scope",
      "chapter",
      "chapters",
      "topic",
      "source",
      "difficulty",
      "total_marks",
      "duration_minutes",
      "variant_count"
    ])
  end
end
