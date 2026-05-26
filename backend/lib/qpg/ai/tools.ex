defmodule Qpg.AI.Tools do
  alias Qpg.Logging
  alias Qpg.QuestionBank
  alias Qpg.Sources

  def search_ncert(filters, query, limit) do
    Logging.info("ai.tool.search_ncert.started", %{filters: filters, query: query, limit: limit})

    results = Sources.search_ncert_chunks(filters, query, limit)
    catalog_context = Sources.catalog_context(filters)

    result = %{
      tool: "search_ncert",
      summary: source_summary("NCERT", filters, results),
      query: query,
      count: length(results),
      coverage: coverage(filters, results),
      catalog_context: catalog_context,
      context_blocks: Enum.map(results, &context_block/1),
      results: results
    }

    Logging.info("ai.tool.search_ncert.completed", %{
      count: result.count,
      coverage: result.coverage,
      catalog_chapters: get_in(result, [:catalog_context, :chapter_count])
    })

    result
  end

  def search_pyq(filters, query, limit) do
    Logging.info("ai.tool.search_pyq.started", %{filters: filters, query: query, limit: limit})

    results =
      case Sources.search_pyq_chunks(filters, query, limit) do
        [] ->
          alternate = alternate_pyq_query(query)

          Logging.debug("ai.tool.search_pyq.retrying_with_alternate_query", %{
            query: query,
            alternate_query: alternate
          })

          Sources.search_pyq_chunks(filters, alternate, limit)

        found ->
          found
      end

    result = %{
      tool: "search_pyq",
      summary: source_summary("PYQ", filters, results),
      query: query,
      count: length(results),
      coverage: coverage(filters, results),
      pattern_hints: pyq_pattern_hints(results),
      context_blocks: Enum.map(results, &context_block/1),
      results: results
    }

    Logging.info("ai.tool.search_pyq.completed", %{
      count: result.count,
      coverage: result.coverage,
      pattern_hints: result.pattern_hints
    })

    result
  end

  def search_question_bank(filters, query, limit) do
    Logging.info("ai.tool.search_question_bank.started", %{
      filters: filters,
      query: query,
      limit: limit
    })

    results =
      filters
      |> QuestionBank.result_blocks(normalize_limit(limit))
      |> Enum.filter(fn result ->
        query_text = String.downcase(to_string(query || ""))

        query_text == "" or
          String.contains?(
            String.downcase(to_string(result[:text] || result[:excerpt])),
            query_text
          )
      end)

    result = %{
      tool: "search_question_bank",
      summary: source_summary("Question bank", filters, results),
      query: query,
      count: length(results),
      coverage: coverage(filters, results),
      context_blocks: Enum.map(results, &context_block/1),
      results: results
    }

    Logging.info("ai.tool.search_question_bank.completed", %{count: result.count})
    result
  end

  defp alternate_pyq_query(query) do
    query = to_string(query || "")

    if String.contains?(String.downcase(query), "arithmetic") do
      "terms of an AP"
    else
      query
    end
  end

  def get_marking_scheme(board, class_level, subject, exam_type) do
    Logging.info("ai.tool.get_marking_scheme.started", %{
      board: board,
      class_level: class_level,
      subject: subject,
      exam_type: exam_type
    })

    filters = %{"board" => board, "class_level" => class_level, "subject" => subject}
    scheme = Sources.marking_scheme_context(filters)

    result = %{
      tool: "get_marking_scheme",
      summary:
        "#{board} class #{class_level} #{subject} #{exam_type} marking scheme from owned PYQ corpus",
      count: if(scheme[:found], do: 1, else: 0),
      result: scheme
    }

    Logging.info("ai.tool.get_marking_scheme.completed", %{
      found: scheme[:found],
      section_count: scheme |> Map.get(:sections, []) |> length(),
      maximum_marks: scheme[:maximum_marks]
    })

    result
  end

  defp source_summary(label, filters, results) do
    chapters =
      results
      |> Enum.map(&get_in(&1, [:metadata, :chapter]))
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.uniq()

    "#{label} retrieval for #{filters["board"]} class #{filters["class_level"]} #{filters["subject"]}: #{length(results)} chunks across #{length(chapters)} chapters"
  end

  defp coverage(filters, results) do
    requested = requested_chapters(filters)

    retrieved =
      results
      |> Enum.map(&get_in(&1, [:metadata, :chapter]))
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.uniq()

    %{
      requested_chapters: requested,
      retrieved_chapters: retrieved,
      missing_chapters: requested -- retrieved,
      has_results: results != []
    }
  end

  defp requested_chapters(%{"chapter_scope" => "full_syllabus"}), do: []

  defp requested_chapters(%{"chapters" => chapters}) when is_list(chapters),
    do: Enum.map(chapters, &to_string/1)

  defp requested_chapters(%{"chapter" => chapter}) when chapter not in [nil, ""],
    do: [to_string(chapter)]

  defp requested_chapters(_filters), do: []

  defp context_block(result) do
    %{
      chunk_id: result[:chunk_id] || result[:id],
      document_id: result[:document_id],
      source_type: result[:source_type],
      title: result[:title],
      excerpt: result[:content_excerpt] || result[:excerpt],
      catalog: result[:catalog] || result[:metadata],
      tags: result[:tags] || %{},
      signals: result[:signals] || %{},
      citation: result[:citation]
    }
  end

  defp pyq_pattern_hints(results) do
    signals = Enum.map(results, &(&1[:signals] || %{}))

    %{
      question_types:
        signals
        |> Enum.map(&Map.get(&1, :probable_question_type))
        |> Enum.reject(&is_nil/1)
        |> Enum.frequencies(),
      marks:
        signals
        |> Enum.map(&Map.get(&1, :marks))
        |> Enum.reject(&is_nil/1)
        |> Enum.frequencies(),
      sections:
        signals
        |> Enum.map(&Map.get(&1, :section_label))
        |> Enum.reject(&is_nil/1)
        |> Enum.frequencies(),
      citations: Enum.map(results, & &1[:citation])
    }
  end

  def retrieve_template(template) when is_map(template) do
    Logging.info("ai.tool.retrieve_template.started", %{
      name: template["name"],
      has_formatting: is_map(template["formatting"]),
      inferred_param_keys: template |> Map.get("inferred_params", %{}) |> Map.keys()
    })

    result = %{
      tool: "retrieve_template",
      summary: "Extracted template hints",
      count: 1,
      result: %{
        name: template["name"] || "Uploaded template",
        inferred_params: Map.get(template, "inferred_params", %{}),
        formatting: Map.get(template, "formatting", %{}),
        sections: Map.get(template, "sections", []),
        instructions: Map.get(template, "instructions", ""),
        layout_notes: Map.get(template, "layout_notes", ""),
        image_notes: Map.get(template, "image_notes", ""),
        marking_scheme_position: Map.get(template, "marking_scheme_position", nil),
        answer_key_position: Map.get(template, "answer_key_position", nil)
      }
    }

    Logging.info("ai.tool.retrieve_template.completed", %{
      formatting_keys: result.result.formatting |> Map.keys(),
      section_count: result.result.sections |> List.wrap() |> length()
    })

    result
  end

  def retrieve_template(_template) do
    Logging.info("ai.tool.retrieve_template.skipped", %{reason: "no_template_supplied"})
    %{tool: "retrieve_template", summary: "No template supplied", count: 0, result: %{}}
  end

  def validate_paper(paper_json, target_constraints) do
    Logging.info("ai.tool.validate_paper.started", %{
      paper_id: paper_json["id"],
      target_constraints: target_constraints
    })

    actual =
      paper_json
      |> Map.get("sections", [])
      |> Enum.flat_map(&Map.get(&1, "questions", []))
      |> Enum.reduce(0, fn question, total -> total + (question["marks"] || 0) end)

    target = target_constraints["total_marks"] || get_in(paper_json, ["summary", "total_marks"])

    %{
      tool: "validate_paper",
      summary: "Marks validation",
      count: 1,
      result: %{valid: actual == target, actual_marks: actual, target_marks: target}
    }
  rescue
    error ->
      Logging.error("ai.tool.validate_paper.failed", %{error: Exception.message(error)})
      %{tool: "validate_paper", summary: "Validation failed", count: 0, result: %{valid: false}}
  end

  def rebalance_paper(paper_json, target_marks, difficulty_mix, question_types) do
    Logging.info("ai.tool.rebalance_paper.requested", %{
      paper_id: paper_json["id"],
      target_marks: target_marks,
      difficulty_mix: difficulty_mix,
      question_types: question_types
    })

    %{
      tool: "rebalance_paper",
      summary: "Rebalance requested to #{target_marks} marks",
      count: 1,
      result: %{
        paper_json: paper_json,
        target_marks: target_marks,
        difficulty_mix: difficulty_mix,
        question_types: question_types,
        note: "V1 returns constraints for model-side rebalancing."
      }
    }
  end

  def validate_generation_warnings(variants, request) do
    variants
    |> Enum.flat_map(fn variant ->
      expected = request["total_marks"]
      actual = get_in(variant, ["summary", "total_marks"])

      if expected && actual != expected do
        ["#{variant["id"]} expected #{expected} marks but has #{actual}"]
      else
        []
      end
    end)
  end

  defp normalize_limit(limit) when is_integer(limit), do: limit |> max(1) |> min(20)

  defp normalize_limit(limit) when is_binary(limit) do
    case Integer.parse(limit) do
      {number, _} -> normalize_limit(number)
      :error -> 8
    end
  end

  defp normalize_limit(_), do: 8
end
