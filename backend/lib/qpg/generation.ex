defmodule Qpg.Generation do
  alias Qpg.AI.Orchestrator
  alias Qpg.AI.Provider
  alias Qpg.Generation.GeneratePaperWorker
  alias Qpg.Generation.GenerationRun
  alias Qpg.Logging
  alias Qpg.Papers
  alias Qpg.Repo
  alias Qpg.Sources

  def create_run(attrs) do
    Logging.info("generation.create_run.received", %{
      mode: attrs["mode"],
      has_free_prompt: attrs["free_prompt"] not in [nil, ""],
      parameter_keys: attrs |> Map.get("parameters", %{}) |> Map.keys(),
      has_template: not is_nil(attrs["template"])
    })

    request = normalize_request(attrs)

    with {:ok, run} <- insert_queued_run(attrs, request),
         {:ok, _job} <- enqueue_generation(run) do
      Logging.info("generation.create_run.queued", %{
        run_id: run.id,
        mode: run.mode,
        request: request_summary(request)
      })

      broadcast(run, "queued", %{
        message: "Generation queued",
        progress: 5,
        step: "queued"
      })

      {:ok, run}
    end
  rescue
    error ->
      Logging.error("generation.create_run.failed", %{error: Exception.message(error)})
      {:error, Exception.message(error)}
  end

  def get_run!(id), do: Repo.get!(GenerationRun, id)

  def perform_run(run_id) do
    run = get_run!(run_id)

    Logging.info("generation.perform_run.started", %{
      run_id: run.id,
      mode: run.mode,
      request: request_summary(run.request)
    })

    update_run(run, %{
      status: "running",
      warnings: []
    })

    broadcast(run, "progress", %{
      message: "Parsing request and routing model",
      progress: 15,
      step: "parse"
    })

    broadcast(run, "progress", %{
      message: "Searching NCERT/PYQ and marking scheme context",
      progress: 35,
      step: "retrieve"
    })

    retrieval_preview = Sources.retrieval_preview(run.request)
    :ok = ensure_owned_source_coverage!(run.request, retrieval_preview)

    Process.put(:qpg_generation_run_id, run.id)
    Process.put(:qpg_ai_operation, "generation")

    result =
      try do
        Orchestrator.generate(
          Map.put(run.request, "retrieval_preview", compact_retrieval_preview(retrieval_preview))
        )
      after
        Process.delete(:qpg_generation_run_id)
        Process.delete(:qpg_ai_operation)
      end

    Logging.info("generation.perform_run.ai_result", %{
      run_id: run.id,
      variant_count: result |> fetch("variants", []) |> length(),
      warning_count: result |> fetch("warnings", []) |> length(),
      tool_trace: fetch(result, "tool_trace", [])
    })

    broadcast(run, "progress", %{
      message: "Saving generated variants",
      progress: 80,
      step: "save"
    })

    papers =
      result
      |> fetch("variants", [])
      |> Enum.map(fn variant ->
        {:ok, paper} = Papers.create_paper_from_variant(variant, run.request, run.mode)
        paper
      end)

    Logging.info("generation.perform_run.papers_saved", %{
      run_id: run.id,
      paper_ids: Enum.map(papers, & &1.id)
    })

    {:ok, completed_run} =
      update_run(run, %{
        status: "completed",
        variants: fetch(result, "variants", []),
        warnings: fetch(result, "warnings", []),
        tool_trace: fetch(result, "tool_trace", []),
        paper_ids: Enum.map(papers, & &1.id)
      })

    broadcast(completed_run, "completed", %{
      message: "Question papers ready",
      progress: 100,
      step: "completed",
      run: serialize(completed_run)
    })

    {:ok, completed_run}
  rescue
    error ->
      Logging.error("generation.perform_run.failed", %{
        run_id: run_id,
        error: Exception.message(error)
      })

      run = get_run!(run_id)

      {:ok, failed_run} =
        update_run(run, %{
          status: "failed",
          warnings: ["Generation failed: #{Exception.message(error)}"]
        })

      broadcast(failed_run, "failed", %{
        message: "Generation failed",
        progress: 100,
        step: "failed",
        run: serialize(failed_run)
      })

      reraise error, __STACKTRACE__
  end

  def serialize(run) do
    %{
      id: run.id,
      mode: run.mode,
      request: run.request,
      status: run.status,
      variants: run.variants,
      warnings: run.warnings,
      tool_trace: run.tool_trace,
      paper_ids: run.paper_ids
    }
  end

  def normalize_request(%{"free_prompt" => prompt} = attrs)
      when is_binary(prompt) and prompt != "" do
    Logging.info("generation.normalize_request.free_prompt", %{
      prompt: prompt,
      has_structured_parameters: is_map(attrs["parameters"])
    })

    extracted = extract_prompt_request!(prompt)

    attrs
    |> Map.get("parameters", %{})
    |> Map.merge(extracted)
    |> merge_template(attrs)
    |> Map.put("free_prompt", prompt)
    |> with_defaults()
  end

  def normalize_request(attrs) do
    Logging.debug("generation.normalize_request.structured", %{
      keys: attrs |> Map.get("parameters", attrs) |> Map.keys()
    })

    attrs |> Map.get("parameters", attrs) |> merge_template(attrs) |> with_defaults()
  end

  defp extract_prompt_request!(prompt) do
    if not Provider.enabled?() do
      raise "AI provider is required for free-prompt parameter extraction"
    end

    case Provider.extract_request(prompt) do
      {:ok, parsed} ->
        Logging.info("generation.prompt_extraction.completed", %{parsed: parsed})
        parsed

      {:error, reason} ->
        raise "AI parameter extraction failed: #{inspect(reason)}"
    end
  end

  defp insert_queued_run(attrs, request) do
    %GenerationRun{}
    |> GenerationRun.changeset(%{
      mode:
        attrs["mode"] ||
          if(attrs["free_prompt"] in [nil, ""], do: "structured", else: "free_prompt"),
      request: request,
      status: "queued",
      warnings: []
    })
    |> Repo.insert()
  end

  defp enqueue_generation(run) do
    %{run_id: run.id}
    |> GeneratePaperWorker.new(queue: :ai)
    |> Oban.insert()
    |> tap(fn result ->
      Logging.info("generation.oban.enqueue_result", %{
        run_id: run.id,
        result: summarize_oban_result(result)
      })
    end)
  end

  defp update_run(run, attrs) do
    run
    |> GenerationRun.changeset(attrs)
    |> Repo.update()
  end

  defp merge_template(request, attrs) do
    template = attrs["template"] || request["template"]
    hints = template_hints(template)

    Logging.debug("generation.template.merge", %{
      has_template: is_map(template),
      hint_keys: Map.keys(hints)
    })

    request
    |> Map.merge(Map.get(hints, "inferred_params", %{}), fn _key, current, template_value ->
      if current in [nil, "", []], do: template_value, else: current
    end)
    |> Map.put("template", template)
    |> Map.put("template_context", hints)
  end

  defp template_hints(template) when is_map(template) do
    %{
      "name" => template["name"] || "Uploaded template",
      "formatting" => template["formatting"] || %{},
      "inferred_params" => template["inferred_params"] || %{},
      "sections" => template["sections"] || [],
      "instructions" => template["instructions"] || "",
      "layout_notes" => template["layout_notes"] || "",
      "image_notes" => template["image_notes"] || "",
      "marking_scheme_position" => template["marking_scheme_position"],
      "answer_key_position" => template["answer_key_position"]
    }
  end

  defp template_hints(_), do: %{}

  defp with_defaults(request) do
    normalized =
      request
      |> put_default("board", "CBSE")
      |> put_default("class_level", "10")
      |> put_default("subject", "Maths")
      |> put_default("source", "NCERT + PYQ")
      |> put_default("chapter_scope", infer_chapter_scope(request))
      |> normalize_chapters()
      |> put_default("question_types", ["MCQ", "Short", "Long"])
      |> put_default("difficulty", "Medium")
      |> put_default("total_marks", 80)
      |> put_default("duration_minutes", 180)
      |> put_default("variant_count", 3)

    Logging.debug("generation.request.normalized", %{request: request_summary(normalized)})
    normalized
  end

  defp normalize_chapters(request) do
    chapters =
      request
      |> Map.get("chapters", [])
      |> List.wrap()
      |> Enum.map(&to_string/1)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))

    cond do
      chapters != [] ->
        request |> Map.put("chapters", chapters) |> Map.put_new("chapter", List.first(chapters))

      Map.get(request, "chapter") not in [nil, ""] ->
        Map.put(request, "chapters", [Map.get(request, "chapter")])

      true ->
        Map.put(request, "chapters", [])
    end
  end

  defp infer_chapter_scope(%{"chapter_scope" => scope})
       when scope in ["single", "multiple", "full_syllabus"], do: scope

  defp infer_chapter_scope(%{"chapters" => chapters})
       when is_list(chapters) and length(chapters) > 1, do: "multiple"

  defp infer_chapter_scope(%{"chapter" => chapter}) when chapter in [nil, ""], do: "full_syllabus"
  defp infer_chapter_scope(_), do: "single"

  defp put_default(map, key, default) do
    case Map.get(map, key) do
      nil -> Map.put(map, key, default)
      "" -> Map.put(map, key, default)
      [] -> Map.put(map, key, default)
      _ -> map
    end
  end

  defp fetch(map, key, default) when is_map(map) do
    Map.get(map, key) ||
      case key do
        "variants" -> Map.get(map, :variants)
        "warnings" -> Map.get(map, :warnings)
        "tool_trace" -> Map.get(map, :tool_trace)
        _ -> nil
      end ||
      default
  end

  defp broadcast(run, event, payload) do
    # Channels are the user's progress stream. Logging every broadcast gives us
    # a precise timeline when the UI appears stuck or skips a state.
    Logging.debug("generation.broadcast", %{
      run_id: run.id,
      event: event,
      step: payload[:step],
      progress: payload[:progress]
    })

    Phoenix.PubSub.broadcast(Qpg.PubSub, "generation:#{run.id}", {event, payload})
  end

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
      "question_types",
      "difficulty",
      "total_marks",
      "duration_minutes",
      "variant_count"
    ])
  end

  defp summarize_oban_result({:ok, job}),
    do: %{status: "ok", job_id: job.id, queue: job.queue, state: job.state}

  defp summarize_oban_result({:error, changeset}),
    do: %{status: "error", errors: changeset.errors}

  defp summarize_oban_result(other), do: %{status: "unknown", result: inspect(other)}

  defp ensure_owned_source_coverage!(request, preview) do
    source = String.downcase(to_string(request["source"] || "NCERT + PYQ"))
    needs_ncert = String.contains?(source, "ncert")
    needs_pyq = String.contains?(source, "pyq")
    missing = []
    missing = if needs_ncert and preview.ncert == [], do: ["NCERT" | missing], else: missing
    missing = if needs_pyq and preview.pyq == [], do: ["PYQ" | missing], else: missing

    case Enum.reverse(missing) do
      [] ->
        :ok

      missing_sources ->
        raise "Missing owned source material for #{Enum.join(missing_sources, " + ")}. Upload/import the required corpus or change the source filter."
    end
  end

  defp compact_retrieval_preview(preview) do
    %{
      ncert: Enum.take(preview.ncert, 4),
      pyq: Enum.take(preview.pyq, 4),
      question_bank: Enum.take(preview.question_bank, 4),
      marking_scheme: preview.marking_scheme,
      warnings: preview.warnings
    }
  end
end
