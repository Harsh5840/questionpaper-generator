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
      message: "Pulling dump source questions, chunks, skills, and PYQ format context",
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
          run.request
          |> Map.put("retrieval_preview", compact_retrieval_preview(retrieval_preview))
          |> Map.put("source_mix_policy", source_mix_policy(run.request))
        )
      after
        Process.delete(:qpg_generation_run_id)
        Process.delete(:qpg_ai_operation)
      end
      |> enforce_direct_source_mix(run.request, retrieval_preview)

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
      |> put_default("difficulty_mix", %{"easy" => 20, "medium" => 60, "hard" => 20})
      |> put_default("total_marks", 80)
      |> put_default("duration_minutes", 180)
      |> put_default("variant_count", 3)
      |> put_default(
        "direct_source_mix",
        default_direct_source_mix(request["source"] || "NCERT + PYQ")
      )

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
      "section_blueprint",
      "difficulty",
      "difficulty_mix",
      "total_marks",
      "duration_minutes",
      "variant_count",
      "direct_source_mix"
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
      ncert: preview |> preview_value(:ncert, []) |> Enum.take(8),
      pyq: preview |> preview_value(:pyq, []) |> Enum.take(8),
      question_bank: preview |> preview_value(:question_bank, []) |> Enum.take(6),
      marking_scheme: preview_value(preview, :marking_scheme, %{}),
      section_sources:
        preview |> preview_value(:section_sources, %{}) |> compact_section_sources(),
      warnings: preview_value(preview, :warnings, [])
    }
  end

  defp compact_section_sources(%{chapters: chapters} = section_sources) when is_list(chapters) do
    %{
      ncert_count: section_sources[:ncert_count] || 0,
      pyq_count: section_sources[:pyq_count] || 0,
      chapters:
        chapters
        |> Enum.take(4)
        |> Enum.map(&compact_section_source_chapter/1)
    }
  end

  defp compact_section_sources(%{"chapters" => chapters} = section_sources)
       when is_list(chapters) do
    %{
      ncert_count: section_sources["ncert_count"] || section_sources["ncertCount"] || 0,
      pyq_count: section_sources["pyq_count"] || section_sources["pyqCount"] || 0,
      chapters:
        chapters
        |> Enum.take(4)
        |> Enum.map(&compact_section_source_chapter/1)
    }
  end

  defp compact_section_sources(_), do: %{chapters: [], ncert_count: 0, pyq_count: 0}

  defp compact_section_source_chapter(chapter) when is_map(chapter) do
    %{
      name: chapter[:name] || chapter["name"],
      position: chapter[:position] || chapter["position"],
      sections:
        chapter
        |> preview_value(:sections, [])
        |> Enum.filter(fn section ->
          preview_value(section, :ncert, []) != [] or preview_value(section, :pyq, []) != []
        end)
        |> Enum.take(12)
        |> Enum.map(&compact_section_source_section/1)
    }
  end

  defp compact_section_source_section(section) when is_map(section) do
    %{
      name: section[:name] || section["name"],
      section_type: section[:section_type] || section["section_type"] || section["sectionType"],
      ncert:
        section
        |> preview_value(:ncert, [])
        |> Enum.take(8)
        |> Enum.map(&compact_source_result/1),
      pyq:
        section
        |> preview_value(:pyq, [])
        |> Enum.take(6)
        |> Enum.map(&compact_source_result/1)
    }
  end

  defp compact_source_result(result) when is_map(result) do
    %{
      title: result[:title] || result["title"],
      citation: result[:citation] || result["citation"],
      excerpt:
        (result[:excerpt] || result["excerpt"] || "")
        |> to_string()
        |> String.slice(0, 700),
      marks: result[:marks] || result["marks"],
      difficulty: result[:difficulty] || result["difficulty"],
      question_type: result[:question_type] || result["question_type"] || result["questionType"],
      section_label:
        get_in(result, [:metadata, :section_label]) ||
          get_in(result, ["metadata", "section_label"]) ||
          get_in(result, [:signals, :section_label]) ||
          get_in(result, ["signals", "section_label"])
    }
  end

  defp preview_value(map, key, default) when is_map(map) do
    Map.get(map, key) || Map.get(map, to_string(key)) || default
  end

  defp preview_value(_map, _key, default), do: default

  defp enforce_direct_source_mix(%{"variants" => variants} = result, request, preview) do
    policy = source_mix_policy(request)

    {variants, warnings} =
      Enum.map_reduce(variants, [], fn variant, accumulated_warnings ->
        {variant, variant_warnings} = apply_direct_source_mix(variant, request, preview, policy)
        {variant, accumulated_warnings ++ variant_warnings}
      end)

    result
    |> Map.put("variants", variants)
    |> Map.update("warnings", Enum.uniq(warnings), fn existing ->
      (List.wrap(existing) ++ warnings) |> Enum.uniq()
    end)
  end

  defp enforce_direct_source_mix(result, _request, _preview), do: result

  defp apply_direct_source_mix(variant, request, preview, policy) do
    slots = question_slots(variant)
    targets = source_mix_targets(length(slots), policy)

    {variant, slots, warnings} =
      [
        {"direct_ncert", targets.ncert, direct_source_candidates(preview, :ncert)},
        {"direct_pyq", targets.pyq, direct_source_candidates(preview, :pyq)},
        {"question_bank", targets.question_bank,
         direct_source_candidates(preview, :question_bank)}
      ]
      |> Enum.reduce({variant, slots, []}, fn {mode, target, candidates},
                                              {current_variant, current_slots, warnings} ->
        current_count = source_mix_counts(current_slots).counts[mode] || 0
        needed = max(target - current_count, 0)

        {next_variant, next_slots, remaining} =
          fill_source_need(current_variant, current_slots, mode, needed, candidates, request)

        next_warnings =
          if remaining > 0 do
            [
              "Source mix target partially met for #{source_mode_label(mode)}: #{remaining} more compatible direct question(s) needed."
              | warnings
            ]
          else
            warnings
          end

        {next_variant, next_slots, next_warnings}
      end)

    source_mix = source_mix_counts(slots).public

    variant =
      variant
      |> Map.put("source_mix", source_mix)
      |> put_in(["summary", "source_coverage"], source_mix_summary(source_mix, policy))
      |> append_source_mix_warnings(warnings)

    {variant, Enum.reverse(warnings)}
  end

  defp fill_source_need(variant, slots, _mode, needed, _candidates, _request) when needed <= 0,
    do: {variant, slots, 0}

  defp fill_source_need(variant, slots, mode, needed, candidates, request) do
    candidates
    |> Enum.reduce_while({variant, slots, needed}, fn candidate,
                                                      {current_variant, current_slots, remaining} ->
      if remaining <= 0 do
        {:halt, {current_variant, current_slots, 0}}
      else
        with {:ok, imported} <- import_direct_candidate(candidate, request),
             {:ok, slot_index, slot} <- compatible_slot(current_slots, imported),
             prepared <- prepare_direct_question(imported, slot.question, mode) do
          next_variant = put_question_at_slot(current_variant, slot, prepared)
          next_slots = List.replace_at(current_slots, slot_index, %{slot | question: prepared})
          {:cont, {next_variant, next_slots, remaining - 1}}
        else
          _ -> {:cont, {current_variant, current_slots, remaining}}
        end
      end
    end)
  end

  defp import_direct_candidate(candidate, request) do
    source_type = preview_value(candidate, :source_type, nil)
    id = preview_value(candidate, :id, nil)

    cond do
      source_type in [nil, ""] or id in [nil, ""] -> {:error, :missing_source_identity}
      true -> Sources.import_question_from_source(source_type, id, request)
    end
  end

  defp compatible_slot(slots, imported) do
    preferred_index =
      Enum.find_index(slots, fn slot ->
        not direct_question?(slot.question) and compatible_question_type?(slot.question, imported)
      end)

    fallback_index =
      Enum.find_index(slots, fn slot ->
        not direct_question?(slot.question) and
          normalize_question_type(slot.question["type"]) != "MCQ"
      end)

    case preferred_index || fallback_index do
      nil -> {:error, :no_compatible_slot}
      index -> {:ok, index, Enum.at(slots, index)}
    end
  end

  defp compatible_question_type?(target, imported) do
    target_type = normalize_question_type(target["type"])
    imported_type = normalize_question_type(imported["type"])

    cond do
      target_type == "MCQ" -> imported_type == "MCQ" and List.wrap(imported["options"]) != []
      imported_type == "MCQ" -> false
      target_type in ["SA", "VSA", "LA", "CASE STUDY"] -> true
      true -> target_type == imported_type
    end
  end

  defp prepare_direct_question(imported, target, mode) do
    imported
    |> Map.put("id", target["id"] || imported["id"] || Ecto.UUID.generate())
    |> Map.put("marks", target["marks"] || imported["marks"] || 1)
    |> Map.put("type", target["type"] || imported["type"] || "SA")
    |> Map.put("difficulty", target["difficulty"] || imported["difficulty"] || "Medium")
    |> Map.put("generationMode", mode)
    |> Map.put_new("answer", "")
    |> Map.put_new("answerRichText", "")
  end

  defp put_question_at_slot(variant, slot, question) do
    put_in(
      variant,
      ["sections", Access.at(slot.section_index), "questions", Access.at(slot.question_index)],
      question
    )
  end

  defp question_slots(%{"sections" => sections}) when is_list(sections) do
    sections
    |> Enum.with_index()
    |> Enum.flat_map(fn {section, section_index} ->
      section
      |> Map.get("questions", [])
      |> List.wrap()
      |> Enum.with_index()
      |> Enum.map(fn {question, question_index} ->
        %{section_index: section_index, question_index: question_index, question: question}
      end)
    end)
  end

  defp question_slots(_variant), do: []

  defp direct_source_candidates(preview, key) do
    preview
    |> preview_value(key, [])
    |> Enum.filter(fn candidate ->
      source_type = preview_value(candidate, :source_type, "")

      case key do
        :ncert -> source_type in ["dump_question", "ncert_question", "ingested_question"]
        :pyq -> source_type in ["dump_pyq_question", "pyq_question"]
        :question_bank -> source_type == "question_bank"
        _ -> false
      end
    end)
    |> Enum.uniq_by(&preview_value(&1, :id, ""))
  end

  defp source_mix_counts(slots) do
    counts =
      Enum.reduce(
        slots,
        %{
          "direct_ncert" => 0,
          "direct_pyq" => 0,
          "question_bank" => 0,
          "ai_generated" => 0,
          "uncited" => 0
        },
        fn slot, acc ->
          mode = source_mode(slot.question)
          Map.update!(acc, mode, &(&1 + 1))
        end
      )

    %{
      counts: counts,
      public: %{
        "ncert" => counts["direct_ncert"],
        "pyq" => counts["direct_pyq"],
        "question_bank" => counts["question_bank"],
        "ai_generated" => counts["ai_generated"],
        "uncited" => counts["uncited"]
      }
    }
  end

  defp source_mode(question) do
    mode = question["generationMode"] || question["generation_mode"]

    source =
      "#{mode} #{question["source"]} #{Enum.join(List.wrap(question["sourceCitations"] || question["source_citations"]), " ")}"
      |> String.downcase()

    cond do
      mode == "direct_ncert" or String.contains?(source, "direct_ncert") ->
        "direct_ncert"

      mode == "direct_pyq" or String.contains?(source, "direct_pyq") ->
        "direct_pyq"

      mode == "question_bank" or String.contains?(source, "question bank") ->
        "question_bank"

      mode == "ai_generated" or question_has_citation?(question) or
          String.contains?(source, "ai generated") ->
        "ai_generated"

      true ->
        "uncited"
    end
  end

  defp direct_question?(question),
    do: source_mode(question) in ["direct_ncert", "direct_pyq", "question_bank"]

  defp question_has_citation?(question) do
    List.wrap(question["sourceCitations"] || question["source_citations"]) != []
  end

  defp source_mix_targets(total_questions, policy) do
    ncert = percentage_count(total_questions, policy.ncert)
    pyq = percentage_count(total_questions, policy.pyq)
    question_bank = percentage_count(total_questions, policy.question_bank)
    direct_total = ncert + pyq + question_bank

    if direct_total <= total_questions do
      %{ncert: ncert, pyq: pyq, question_bank: question_bank}
    else
      scale = total_questions / max(direct_total, 1)

      %{
        ncert: floor(ncert * scale),
        pyq: floor(pyq * scale),
        question_bank: max(total_questions - floor(ncert * scale) - floor(pyq * scale), 0)
      }
    end
  end

  defp percentage_count(total, percent), do: round(total * percent / 100)

  defp source_mix_policy(request) do
    raw = request["direct_source_mix"] || %{}
    source = request["source"] || "NCERT + PYQ"

    explicit = %{
      ncert: numeric(raw["ncertDirect"] || raw["ncert_direct"], nil),
      pyq: numeric(raw["pyqDirect"] || raw["pyq_direct"], nil),
      question_bank: numeric(raw["questionBank"] || raw["question_bank"], nil),
      ai_generated: numeric(raw["aiGenerated"] || raw["ai_generated"], nil)
    }

    policy =
      if Enum.any?(explicit, fn {_key, value} -> is_number(value) end) do
        %{
          ncert: explicit.ncert || 0,
          pyq: explicit.pyq || 0,
          question_bank: explicit.question_bank || 0,
          ai_generated: explicit.ai_generated || 0
        }
      else
        legacy_or_default_source_mix(raw, source)
      end

    normalize_source_mix_policy(policy, source)
  end

  defp legacy_or_default_source_mix(raw, source) do
    dump_direct = numeric(raw["dumpDirect"] || raw["dump_direct"], nil)
    ai_from_dump = numeric(raw["aiFromDump"] || raw["ai_from_dump"], 100 - (dump_direct || 70))

    if is_number(dump_direct) do
      case source do
        "NCERT" ->
          %{ncert: dump_direct, pyq: 0, question_bank: 0, ai_generated: ai_from_dump}

        "PYQ" ->
          %{ncert: 0, pyq: dump_direct, question_bank: 0, ai_generated: ai_from_dump}

        _ ->
          ncert = round(dump_direct * 0.57)
          %{ncert: ncert, pyq: dump_direct - ncert, question_bank: 0, ai_generated: ai_from_dump}
      end
    else
      default_source_mix_policy(source)
    end
  end

  defp default_direct_source_mix("NCERT"),
    do: %{"ncertDirect" => 70, "pyqDirect" => 0, "questionBank" => 0, "aiGenerated" => 30}

  defp default_direct_source_mix("PYQ"),
    do: %{"ncertDirect" => 0, "pyqDirect" => 70, "questionBank" => 0, "aiGenerated" => 30}

  defp default_direct_source_mix(_),
    do: %{"ncertDirect" => 40, "pyqDirect" => 30, "questionBank" => 0, "aiGenerated" => 30}

  defp default_source_mix_policy("NCERT"),
    do: %{ncert: 70, pyq: 0, question_bank: 0, ai_generated: 30}

  defp default_source_mix_policy("PYQ"),
    do: %{ncert: 0, pyq: 70, question_bank: 0, ai_generated: 30}

  defp default_source_mix_policy(_), do: %{ncert: 40, pyq: 30, question_bank: 0, ai_generated: 30}

  defp normalize_source_mix_policy(policy, source) do
    policy =
      policy
      |> Map.update!(:ncert, &max(round(&1), 0))
      |> Map.update!(:pyq, &max(round(&1), 0))
      |> Map.update!(:question_bank, &max(round(&1), 0))
      |> Map.update!(:ai_generated, &max(round(&1), 0))

    policy =
      case source do
        "NCERT" -> %{policy | pyq: 0}
        "PYQ" -> %{policy | ncert: 0}
        _ -> policy
      end

    total = policy.ncert + policy.pyq + policy.question_bank + policy.ai_generated

    if total == 100 or total == 0 do
      if total == 0, do: default_source_mix_policy(source), else: policy
    else
      %{
        ncert: round(policy.ncert * 100 / total),
        pyq: round(policy.pyq * 100 / total),
        question_bank: round(policy.question_bank * 100 / total),
        ai_generated: 0
      }
      |> then(fn normalized ->
        %{
          normalized
          | ai_generated: 100 - normalized.ncert - normalized.pyq - normalized.question_bank
        }
      end)
    end
  end

  defp source_mix_summary(source_mix, policy) do
    "Target #{policy.ncert}% NCERT direct / #{policy.pyq}% PYQ direct / #{policy.question_bank}% bank / #{policy.ai_generated}% AI; actual #{source_mix["ncert"]} NCERT, #{source_mix["pyq"]} PYQ, #{source_mix["question_bank"]} bank, #{source_mix["ai_generated"]} AI, #{source_mix["uncited"]} uncited."
  end

  defp append_source_mix_warnings(variant, []), do: variant

  defp append_source_mix_warnings(variant, warnings) do
    Map.update(variant, "warnings", Enum.uniq(warnings), fn existing ->
      (List.wrap(existing) ++ warnings) |> Enum.uniq()
    end)
  end

  defp source_mode_label("direct_ncert"), do: "NCERT direct"
  defp source_mode_label("direct_pyq"), do: "PYQ direct"
  defp source_mode_label("question_bank"), do: "question bank"
  defp source_mode_label(mode), do: mode

  defp normalize_question_type(value) do
    text = value |> to_string() |> String.downcase()

    cond do
      text in ["mcq", "multiple choice"] -> "MCQ"
      String.contains?(text, "case") -> "CASE STUDY"
      String.contains?(text, "very") or text == "vsa" -> "VSA"
      String.contains?(text, "long") or text == "la" -> "LA"
      String.contains?(text, "short") or text == "sa" -> "SA"
      true -> String.upcase(to_string(value || "SA"))
    end
  end

  defp numeric(value, _default) when is_number(value), do: value

  defp numeric(value, default) when is_binary(value) do
    case Float.parse(value) do
      {number, _} -> number
      :error -> default
    end
  end

  defp numeric(_value, default), do: default
end
