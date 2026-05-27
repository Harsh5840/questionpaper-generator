defmodule Qpg.AI.Gemini do
  @moduledoc """
  Gemini GenerateContent boundary with function-calling support.
  """

  alias Qpg.Logging
  alias Qpg.AI.Usage
  alias Qpg.AI.Prompts
  alias Qpg.AI.Tools

  @endpoint_base "https://generativelanguage.googleapis.com/v1beta/models"

  def enabled?, do: api_key() not in [nil, ""]

  def extract_request(prompt) when is_binary(prompt) do
    Logging.info("ai.gemini.extract_request.received", %{prompt: prompt})
    if not enabled?(), do: {:error, :gemini_disabled}, else: do_extract_request(prompt)
  end

  def generate_bundle(request) when is_map(request) do
    Logging.info("ai.gemini.generate_bundle.received", %{request: request_summary(request)})
    if not enabled?(), do: {:error, :gemini_disabled}, else: do_generate_bundle(request)
  end

  def refine_bundle(paper, instruction) do
    Logging.info("ai.gemini.refine_bundle.received", %{
      paper_id: paper["id"] || paper[:id],
      instruction: instruction
    })

    if not enabled?(), do: {:error, :gemini_disabled}, else: do_refine_bundle(paper, instruction)
  end

  def extract_question_from_image(image_base64, mime_type, request) do
    Logging.info("ai.gemini.extract_question_from_image.received", %{
      mime_type: mime_type,
      request: request_summary(request)
    })

    if not enabled?(),
      do: {:error, :gemini_disabled},
      else: do_extract_question_from_image(image_base64, mime_type, request)
  end

  defp do_extract_request(prompt) do
    payload =
      base_payload(
        """
        #{Prompts.system_prompt()}

        #{Prompts.parameter_extraction_prompt()}

        Return JSON only.

        User prompt:
        #{prompt}
        """,
        paper_request_schema()
      )

    model = model_for(:small)
    Logging.info("ai.gemini.extract_request.calling_model", %{model: model})

    with {:ok, response} <- generate_content(model, payload),
         {:ok, json} <- extract_json(response) do
      Logging.info("ai.gemini.extract_request.completed", %{keys: Map.keys(json)})
      {:ok, json}
    end
  end

  defp do_generate_bundle(request) do
    target_variants = int_value(request["variant_count"], 1)

    if target_variants > 1 do
      generate_variant_bundles(request, target_variants)
    else
      do_generate_single_bundle_with_retry(request, 1)
    end
  end

  defp generate_variant_bundles(request, target_variants) do
    parent_run_id = Process.get(:qpg_generation_run_id)
    parent_operation = Process.get(:qpg_ai_operation)

    results =
      1..target_variants
      |> Task.async_stream(
        fn index ->
          try do
            if parent_run_id, do: Process.put(:qpg_generation_run_id, parent_run_id)
            if parent_operation, do: Process.put(:qpg_ai_operation, parent_operation)

            request
            |> Map.put("variant_count", 1)
            |> Map.put("variant_index", index)
            |> Map.put(
              "variant_instruction",
              "Generate Set #{set_label(index)}. Use the same blueprint and constraints, but create different fresh questions."
            )
            |> do_generate_single_bundle_with_retry(index)
          after
            Process.delete(:qpg_generation_run_id)
            Process.delete(:qpg_ai_operation)
          end
        end,
        max_concurrency: min(target_variants, 3),
        timeout: 180_000
      )
      |> Enum.to_list()

    with {:ok, variants} <- collect_variant_results(results),
         normalized <- %{
           "variants" => variants,
           "warnings" => [],
           "tool_trace" => []
         },
         :ok <- validate_generation(normalized, request) do
      {:ok, normalized}
    end
  end

  defp do_generate_single_bundle_with_retry(request, variant_index, attempts_left \\ 2) do
    case do_generate_single_bundle(request, variant_index) do
      {:ok, bundle} ->
        {:ok, bundle}

      {:error, reason} when attempts_left > 0 ->
        if retryable_generation_error?(reason) do
          Logging.warning("ai.gemini.generate_bundle.retrying_variant", %{
            variant_index: variant_index,
            reason: inspect(reason),
            attempts_left: attempts_left
          })

          do_generate_single_bundle_with_retry(request, variant_index, attempts_left - 1)
        else
          {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_generate_single_bundle(request, variant_index) do
    contents = [
      user_content("""
      #{Prompts.system_prompt()}

      #{Prompts.generation_prompt()}

      Return JSON only. Do not wrap the response in Markdown.

      Normalized PaperRequest JSON:
      #{Jason.encode!(request)}
      """)
    ]

    payload =
      %{
        contents: contents,
        tools: [%{functionDeclarations: gemini_tools()}],
        toolConfig: %{functionCallingConfig: %{mode: "AUTO"}},
        generationConfig: generation_text_config(:generation)
      }

    model = model_for(:generation, request)

    Logging.info("ai.gemini.generate_bundle.calling_model", %{
      model: model,
      request: request_summary(request)
    })

    with {:ok, response} <- gemini_loop(model, payload),
         {:ok, json} <- extract_json(response),
         {:ok, normalized} <- normalize_generation_json(json, request),
         :ok <- validate_generation(normalized, request) do
      normalized = normalize_single_variant_identity(normalized, variant_index)

      Logging.info("ai.gemini.generate_bundle.completed", %{
        variant_count: normalized |> Map.get("variants", []) |> length(),
        warning_count: normalized |> Map.get("warnings", []) |> length()
      })

      {:ok, normalized}
    end
  end

  defp collect_variant_results(results) do
    results
    |> Enum.reduce_while({:ok, []}, fn
      {:ok, {:ok, %{"variants" => [variant | _]}}}, {:ok, variants} ->
        {:cont, {:ok, variants ++ [variant]}}

      {:ok, {:error, reason}}, _acc ->
        {:halt, {:error, reason}}

      {:exit, reason}, _acc ->
        {:halt, {:error, {:variant_task_failed, reason}}}

      other, _acc ->
        {:halt, {:error, {:unexpected_variant_result, other}}}
    end)
  end

  defp normalize_single_variant_identity(%{"variants" => [variant | rest]} = normalized, index) do
    variant =
      variant
      |> Map.put("id", "variant-#{index}")
      |> Map.update("title", "Set #{set_label(index)}", fn title ->
        title = safe_text(title, "Question Paper")

        if String.contains?(String.downcase(title), "set #{String.downcase(set_label(index))}") do
          title
        else
          "#{title} - Set #{set_label(index)}"
        end
      end)

    %{normalized | "variants" => [variant | rest]}
  end

  defp normalize_single_variant_identity(normalized, _index), do: normalized

  defp set_label(index), do: <<?A + index - 1::utf8>>

  defp do_refine_bundle(paper, instruction) do
    contents = [
      user_content("""
      #{Prompts.system_prompt()}

      #{Prompts.refinement_prompt()}

      Return a minimal reviewable patch and preview JSON.
      Return JSON only. Do not wrap the response in Markdown.

      #{Jason.encode!(%{paper: paper, instruction: instruction})}
      """)
    ]

    payload =
      %{
        contents: contents,
        tools: [%{functionDeclarations: gemini_tools()}],
        toolConfig: %{functionCallingConfig: %{mode: "AUTO"}},
        generationConfig: generation_text_config(:refinement)
      }

    model = model_for(:post_generation_fix, instruction)

    Logging.info("ai.gemini.refine_bundle.calling_model", %{
      model: model,
      instruction: instruction
    })

    with {:ok, response} <- gemini_loop(model, payload),
         {:ok, json} <- extract_json(response) do
      Logging.info("ai.gemini.refine_bundle.completed", %{
        patch_count: json |> Map.get("patch_ops", []) |> length()
      })

      {:ok, json}
    end
  end

  defp do_extract_question_from_image(image_base64, mime_type, request) do
    payload =
      %{
        contents: [
          %{
            role: "user",
            parts: [
              %{
                text: """
                #{Prompts.system_prompt()}

                Extract the question from this image into editable JSON. Preserve math, options,
                marks, answer or marking scheme if visible. Do not invent missing content.

                Return JSON only using this shape:
                {
                  "id": "image-question",
                  "text": "...",
                  "marks": 1,
                  "type": "MCQ|VSA|SA|LA|Case Study",
                  "difficulty": "Low|Medium|High",
                  "source": "Image import",
                  "topic": "...",
                  "answer": "",
                  "tags": []
                }

                Request context:
                #{Jason.encode!(request)}
                """
              },
              %{inlineData: %{mimeType: mime_type, data: image_base64}}
            ]
          }
        ],
        generationConfig: json_config(question_schema())
      }

    model = System.get_env("GEMINI_VISION_MODEL", model_for(:small))

    Process.put(:qpg_ai_operation, "image_question_import")

    try do
      with {:ok, response} <- generate_content(model, payload),
           {:ok, question} <- extract_json(response) do
        normalized = normalize_imported_question(question, request)

        Logging.info("ai.gemini.extract_question_from_image.completed", %{
          type: normalized["type"],
          marks: normalized["marks"]
        })

        {:ok, normalized}
      end
    after
      Process.delete(:qpg_ai_operation)
    end
  end

  defp gemini_loop(model, payload, iteration \\ 0)

  defp gemini_loop(_model, _payload, iteration) when iteration > 4,
    do: {:error, :too_many_tool_roundtrips}

  defp gemini_loop(model, payload, iteration) do
    Logging.debug("ai.gemini.loop.iteration.started", %{model: model, iteration: iteration})

    with {:ok, response} <- generate_content(model, payload) do
      calls = function_calls(response)

      if calls == [] do
        Logging.debug("ai.gemini.loop.completed_without_tool_calls", %{
          model: model,
          iteration: iteration
        })

        {:ok, response}
      else
        Logging.info("ai.gemini.loop.tool_calls", %{
          model: model,
          iteration: iteration,
          tool_names: Enum.map(calls, & &1["name"])
        })

        function_parts =
          Enum.map(calls, fn %{"name" => name, "args" => args} ->
            %{
              functionResponse: %{
                name: name,
                response: %{result: execute_tool(name, args || %{}) |> compact_tool_result()}
              }
            }
          end)

        call_parts = Enum.map(calls, fn call -> %{functionCall: call} end)

        next_payload =
          payload
          |> Map.put(
            :contents,
            Map.get(payload, :contents, []) ++
              [model_content(call_parts), user_content(function_parts)]
          )
          |> maybe_force_final_json_after_tools(iteration)

        gemini_loop(model, next_payload, iteration + 1)
      end
    end
  end

  defp maybe_force_final_json_after_tools(payload, iteration) when iteration >= 1 do
    payload
    |> Map.delete(:tools)
    |> Map.delete(:toolConfig)
    |> Map.put(:generationConfig, json_text_config(:generation))
  end

  defp maybe_force_final_json_after_tools(payload, _iteration), do: payload

  defp base_payload(prompt, schema) do
    %{
      contents: [user_content(prompt)],
      generationConfig: json_config(schema)
    }
  end

  defp json_config(schema) do
    %{
      responseMimeType: "application/json",
      responseSchema: gemini_schema(schema)
    }
  end

  defp json_text_config(operation) do
    operation
    |> generation_text_config()
    |> Map.put(:responseMimeType, "application/json")
  end

  defp generation_text_config(:generation) do
    %{
      temperature: 0.45,
      maxOutputTokens: 24_576
    }
  end

  defp generation_text_config(_operation) do
    %{
      temperature: 0.25,
      maxOutputTokens: 12_288
    }
  end

  defp user_content(text) when is_binary(text), do: %{role: "user", parts: [%{text: text}]}
  defp user_content(parts) when is_list(parts), do: %{role: "user", parts: parts}
  defp model_content(parts), do: %{role: "model", parts: parts}

  defp generate_content(model, payload) do
    url = "#{@endpoint_base}/#{model}:generateContent?key=#{api_key()}"

    # Do not log the URL: Gemini keys live in the query string.
    Logging.debug("ai.gemini.http.request", %{
      model: model,
      has_tools: payload |> Map.get(:tools, []) |> Enum.any?(),
      response_mime_type: get_in(payload, [:generationConfig, :responseMimeType])
    })

    request =
      Finch.build(
        :post,
        url,
        [{"content-type", "application/json"}],
        Jason.encode!(payload)
      )

    with {:ok, %{status: 200} = response} <-
           Finch.request(request, Qpg.Finch, receive_timeout: 120_000),
         {:ok, body} <- Jason.decode(response.body) do
      Logging.debug("ai.gemini.http.response.ok", %{model: model, status: response.status})
      Usage.record_gemini_event(model, body)
      {:ok, body}
    else
      {:ok, response} ->
        Logging.error("ai.gemini.http.response.error_status", %{
          model: model,
          status: response.status,
          body: decode_body(response.body)
        })

        {:error, %{status: response.status, body: decode_body(response.body)}}

      {:error, reason} ->
        Logging.error("ai.gemini.http.request.failed", %{model: model, reason: inspect(reason)})
        {:error, reason}

      {:error, reason, _position} ->
        Logging.error("ai.gemini.http.decode.failed", %{model: model, reason: inspect(reason)})
        {:error, reason}
    end
  end

  defp decode_body(body) do
    case Jason.decode(body) do
      {:ok, decoded} -> decoded
      {:error, _} -> body
    end
  end

  defp extract_json(response) do
    finish_reason =
      response
      |> Map.get("candidates", [])
      |> List.first(%{})
      |> Map.get("finishReason")

    text =
      response
      |> Map.get("candidates", [])
      |> Enum.flat_map(&(get_in(&1, ["content", "parts"]) || []))
      |> Enum.find_value(fn
        %{"text" => text} when is_binary(text) -> text
        _ -> nil
      end)

    case text do
      nil ->
        {:error, :missing_gemini_text}

      value when finish_reason in ["MAX_TOKENS", "RECITATION", "SAFETY"] ->
        Logging.warning("ai.gemini.extract_json.incomplete_candidate", %{
          finish_reason: finish_reason,
          text_bytes: byte_size(value)
        })

        {:error, {:incomplete_gemini_json, finish_reason}}

      value ->
        value |> strip_json_fence() |> decode_json_with_tool_trace_repair()
    end
  end

  defp decode_json_with_tool_trace_repair(text) do
    case Jason.decode(text) do
      {:ok, decoded} ->
        {:ok, decoded}

      {:error, first_error} ->
        repaired =
          text
          |> String.replace(~r/,\s*"tool_trace"\s*:\s*\[.*$/s, ",\"tool_trace\":[]}")

        case Jason.decode(repaired) do
          {:ok, decoded} ->
            {:ok, decoded}

          {:error, second_error} ->
            Logging.warning("ai.gemini.extract_json.decode_failed", %{
              first_error: format_decode_error(first_error),
              second_error: format_decode_error(second_error),
              text_bytes: byte_size(text),
              preview: String.slice(text, 0, 800)
            })

            {:error,
             {:invalid_gemini_json,
              %{
                position: decode_error_position(second_error),
                text_bytes: byte_size(text)
              }}}
        end
    end
  end

  defp retryable_generation_error?(reason)

  defp retryable_generation_error?(reason)
       when reason in [
              :missing_gemini_text,
              :invalid_generation_response,
              :generation_returned_no_variants
            ],
       do: true

  defp retryable_generation_error?({:invalid_gemini_json, _metadata}), do: true
  defp retryable_generation_error?({:incomplete_gemini_json, _finish_reason}), do: true
  defp retryable_generation_error?(_reason), do: false

  defp format_decode_error(%Jason.DecodeError{} = error),
    do: %{position: error.position, token: error.token}

  defp format_decode_error(error), do: inspect(error)

  defp decode_error_position(%Jason.DecodeError{position: position}), do: position
  defp decode_error_position(_error), do: nil

  defp strip_json_fence(text) do
    text
    |> String.trim()
    |> String.replace(~r/^```(?:json)?\s*/i, "")
    |> String.replace(~r/\s*```$/, "")
    |> String.trim()
  end

  defp function_calls(response) do
    response
    |> Map.get("candidates", [])
    |> Enum.flat_map(&(get_in(&1, ["content", "parts"]) || []))
    |> Enum.flat_map(fn
      %{"functionCall" => call} -> [call]
      _ -> []
    end)
  end

  defp execute_tool("search_ncert", args),
    do: Tools.search_ncert(args, args["query"], args["limit"] || 6)

  defp execute_tool("search_pyq", args),
    do: Tools.search_pyq(args, args["query"], args["limit"] || 6)

  defp execute_tool("search_question_bank", args),
    do: Tools.search_question_bank(args, args["query"], args["limit"] || 6)

  defp execute_tool("get_marking_scheme", args),
    do:
      Tools.get_marking_scheme(
        args["board"],
        args["class_level"],
        args["subject"],
        args["exam_type"]
      )

  defp execute_tool("retrieve_template", args), do: Tools.retrieve_template(args["template"])

  defp execute_tool("validate_paper", args),
    do: Tools.validate_paper(args["paper_json"], args["target_constraints"])

  defp execute_tool("rebalance_paper", args),
    do:
      Tools.rebalance_paper(
        args["paper_json"],
        args["target_marks"],
        args["difficulty_mix"],
        args["question_types"]
      )

  defp execute_tool(name, args), do: %{tool: name, result: args}

  defp compact_tool_result(%{tool: tool} = result)
       when tool in ["search_ncert", "search_pyq", "search_question_bank"] do
    %{
      tool: result[:tool],
      summary: result[:summary],
      query: result[:query],
      count: result[:count],
      coverage: result[:coverage],
      pattern_hints: result[:pattern_hints],
      catalog_context: compact_catalog_context(result[:catalog_context]),
      context_blocks:
        result
        |> Map.get(:context_blocks, [])
        |> Enum.take(4)
        |> Enum.map(&compact_context_block/1)
    }
  end

  defp compact_tool_result(result), do: result

  defp compact_catalog_context(nil), do: nil

  defp compact_catalog_context(context) do
    %{
      chapter_count: context[:chapter_count],
      chapters:
        context
        |> Map.get(:chapters, [])
        |> Enum.map(fn chapter ->
          %{
            name: chapter[:name],
            position: chapter[:position],
            sections:
              chapter
              |> Map.get(:sections, [])
              |> Enum.take(12)
              |> Enum.map(&Map.take(&1, ["name", "section_type", "position"]))
          }
        end)
    }
  end

  defp compact_context_block(block) do
    %{
      title: block[:title],
      citation: block[:citation],
      catalog: block[:catalog],
      signals: block[:signals],
      excerpt: block[:excerpt] |> to_string() |> String.slice(0, 700)
    }
  end

  defp normalize_generation_json(%{"variants" => variants} = json, _request)
       when is_list(variants) do
    {:ok,
     %{
       "variants" => Enum.map(variants, &normalize_variant/1),
       "warnings" => List.wrap(json["warnings"]),
       "tool_trace" => List.wrap(json["tool_trace"])
     }}
  end

  defp normalize_generation_json(%{"paper" => paper_sections} = json, request)
       when is_list(paper_sections) do
    metadata = Map.merge(request_metadata(request), Map.get(json, "metadata", %{}))
    warnings = List.wrap(json["warnings"]) ++ List.wrap(get_in(json, ["metadata", "warnings"]))

    variant =
      normalize_variant(single_variant_from_sections(paper_sections, metadata, warnings, 1))

    {:ok,
     %{
       "variants" => [variant],
       "warnings" => warnings,
       "tool_trace" => []
     }}
  end

  defp normalize_generation_json(json, _request) do
    Logging.error("ai.gemini.generate_bundle.unexpected_shape", %{json: json})
    {:error, :invalid_generation_response}
  end

  defp single_variant_from_sections(sections, metadata, warnings, index) do
    %{
      "id" => "gemini-variant-#{index}",
      "title" => title_from_metadata(metadata, index),
      "metadata" => metadata,
      "sections" => sections,
      "warnings" => warnings
    }
  end

  defp normalize_variant(variant) when is_map(variant) do
    sections =
      variant |> Map.get("sections", Map.get(variant, "paper", [])) |> normalize_sections()

    summary = variant |> Map.get("summary", %{}) |> normalize_summary(sections)
    metadata = normalize_metadata(Map.get(variant, "metadata", %{}))

    %{
      "id" => to_string(variant["id"] || "gemini-variant-1"),
      "title" => to_string(variant["title"] || title_from_metadata(metadata, 1)),
      "metadata" => metadata,
      "summary" => summary,
      "sections" => sections,
      "warnings" => List.wrap(variant["warnings"])
    }
  end

  defp normalize_sections(sections) when is_list(sections) do
    sections
    |> Enum.with_index(1)
    |> Enum.map(fn {section, index} ->
      section = if is_map(section), do: section, else: %{}
      questions = section |> Map.get("questions", []) |> normalize_questions()

      %{
        "id" => safe_text(section["id"], "section-#{index}"),
        "title" => safe_text(section["title"] || section["section"], "Section #{index}"),
        "instructions" => safe_text(section["instructions"], ""),
        "questions" => questions
      }
    end)
    |> Enum.reject(&Enum.empty?(&1["questions"]))
  end

  defp normalize_sections(_sections), do: []

  defp normalize_questions(questions) when is_list(questions) do
    questions
    |> Enum.with_index(1)
    |> Enum.map(fn {question, index} ->
      question = if is_map(question), do: question, else: %{}
      options = List.wrap(question["options"])
      stem = question["text"] || question["question"]

      repaired =
        repair_question_text(stem, options, question["subparts"] || question["sub_parts"])

      %{
        "id" => safe_text(question["id"], "q#{index}"),
        "text" => repaired.text,
        "options" => repaired.options,
        "subparts" => repaired.subparts,
        "optionalChoice" =>
          normalize_choice(question["optionalChoice"] || question["optional_choice"]),
        "marks" => int_value(question["marks"], 1),
        "type" => safe_text(question["type"] || question["question_type"], ""),
        "difficulty" => safe_text(question["difficulty"], ""),
        "source" => safe_text(question["source"], "AI generated from retrieved context"),
        "answer" => safe_text(question["answer"], ""),
        "answerRichText" =>
          safe_text(question["answerRichText"] || question["answer_rich_text"], ""),
        "sourceCitations" =>
          List.wrap(question["sourceCitations"] || question["source_citations"])
      }
    end)
    |> Enum.reject(&blank_question?/1)
  end

  defp normalize_questions(_questions), do: []

  defp normalize_options(options) when is_list(options) do
    options
    |> Enum.with_index(?A)
    |> Enum.map(fn {option, label} ->
      %{
        "label" => <<label::utf8>>,
        "text" => option_text(option)
      }
    end)
    |> Enum.reject(&(&1["text"] == ""))
  end

  defp normalize_options(_options), do: []

  defp repair_question_text(text, provided_options, provided_subparts) do
    normalized_options = normalize_options(provided_options)
    normalized_subparts = normalize_subparts(provided_subparts)

    cond do
      normalized_options != [] or normalized_subparts != [] ->
        %{text: safe_text(text, ""), options: normalized_options, subparts: normalized_subparts}

      true ->
        case split_inline_blocks(safe_text(text, "")) do
          %{kind: :options, stem: stem, blocks: blocks} ->
            %{text: stem, options: normalize_options(blocks), subparts: []}

          %{kind: :subparts, stem: stem, blocks: blocks} ->
            %{text: stem, options: [], subparts: normalize_subparts(blocks)}

          nil ->
            %{text: safe_text(text, ""), options: [], subparts: []}
        end
    end
  end

  defp normalize_subparts(subparts) when is_list(subparts) do
    subparts
    |> Enum.with_index(1)
    |> Enum.map(fn {subpart, index} ->
      subpart = if is_map(subpart), do: subpart, else: %{}

      %{
        "id" => safe_text(subpart["id"], "part-#{index}"),
        "label" => safe_text(subpart["label"], <<96 + index::utf8>>),
        "text" => safe_text(subpart["text"] || subpart["question"], ""),
        "richText" => safe_text(subpart["richText"] || subpart["rich_text"], ""),
        "marks" => int_value(subpart["marks"], 1),
        "answer" => safe_text(subpart["answer"], ""),
        "answerRichText" =>
          safe_text(subpart["answerRichText"] || subpart["answer_rich_text"], ""),
        "optionalChoice" =>
          normalize_choice(subpart["optionalChoice"] || subpart["optional_choice"])
      }
    end)
    |> Enum.reject(&(&1["text"] == ""))
  end

  defp normalize_subparts(_subparts), do: []

  defp normalize_choice(choice) when is_map(choice) do
    %{
      "id" => safe_text(choice["id"], Ecto.UUID.generate()),
      "text" => safe_text(choice["text"] || choice["question"], ""),
      "richText" => safe_text(choice["richText"] || choice["rich_text"], ""),
      "options" => normalize_options(List.wrap(choice["options"])),
      "marks" => int_value(choice["marks"], 1),
      "type" => safe_text(choice["type"] || choice["question_type"], ""),
      "difficulty" => safe_text(choice["difficulty"], ""),
      "source" => safe_text(choice["source"], ""),
      "topic" => safe_text(choice["topic"], ""),
      "answer" => safe_text(choice["answer"], ""),
      "answerRichText" => safe_text(choice["answerRichText"] || choice["answer_rich_text"], "")
    }
  end

  defp normalize_choice(_choice), do: nil

  defp split_inline_blocks(text) when is_binary(text) do
    pattern = ~r/(?:^|\s)(\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[a-eA-E])\)|[A-D][.)])\s*/iu
    matches = Regex.scan(pattern, text, return: :index)

    if length(matches) < 2 do
      nil
    else
      labels =
        Regex.scan(pattern, text)
        |> Enum.map(fn [_full, label] -> String.trim(label) end)

      [{first_start, _} | _] = List.first(matches)
      stem = text |> String.slice(0, first_start) |> String.trim()

      blocks =
        matches
        |> Enum.with_index()
        |> Enum.map(fn {[{start, full_length}, {_label_start, _label_length}], index} ->
          content_start = start + full_length

          content_end =
            case Enum.at(matches, index + 1) do
              [{next_start, _} | _] -> next_start
              _ -> String.length(text)
            end

          %{
            "label" => Enum.at(labels, index),
            "text" =>
              text |> String.slice(content_start, content_end - content_start) |> String.trim()
          }
        end)
        |> Enum.reject(&(&1["text"] == ""))

      kind =
        if Enum.all?(labels, &Regex.match?(~r/^\([a-e]\)$/i, &1)),
          do: :subparts,
          else: :options

      %{kind: kind, stem: stem, blocks: blocks}
    end
  end

  defp split_inline_blocks(_text), do: nil

  defp normalize_imported_question(question, request) when is_map(question) do
    %{
      "id" => safe_text(question["id"], Ecto.UUID.generate()),
      "text" => safe_text(question["text"] || question["question"], ""),
      "richText" => safe_text(question["richText"] || question["rich_text"], ""),
      "marks" => int_value(question["marks"], 1),
      "type" => safe_text(question["type"] || question["question_type"], "SA"),
      "difficulty" => safe_text(question["difficulty"], "Medium"),
      "source" => safe_text(question["source"], "Image import"),
      "topic" => safe_text(question["topic"] || request["topic"] || request["chapter"], ""),
      "options" => normalize_options(List.wrap(question["options"])),
      "subparts" => normalize_subparts(question["subparts"] || question["sub_parts"]),
      "optionalChoice" =>
        normalize_choice(question["optionalChoice"] || question["optional_choice"]),
      "answer" => safe_text(question["answer"], ""),
      "answerRichText" =>
        safe_text(question["answerRichText"] || question["answer_rich_text"], ""),
      "tags" => List.wrap(question["tags"])
    }
  end

  defp normalize_summary(summary, sections) do
    questions = Enum.flat_map(sections, & &1["questions"])
    total_marks = Enum.reduce(questions, 0, &(&2 + int_value(&1["marks"], 0)))

    %{
      "total_marks" => int_value(summary["total_marks"], total_marks),
      "question_count" => int_value(summary["question_count"], length(questions)),
      "difficulty" => safe_text(summary["difficulty"], ""),
      "source_coverage" => safe_text(summary["source_coverage"] || summary["sourceCoverage"], "")
    }
  end

  defp normalize_metadata(metadata) when is_map(metadata) do
    %{
      "board" => safe_text(metadata["board"], ""),
      "class_level" => safe_text(metadata["class_level"] || metadata["classLevel"], ""),
      "subject" => safe_text(metadata["subject"], ""),
      "chapter" => metadata["chapter"],
      "topic" => metadata["topic"],
      "duration_minutes" =>
        int_value(metadata["duration_minutes"] || metadata["durationMinutes"], 180),
      "source" => safe_text(metadata["source"], "")
    }
  end

  defp request_metadata(request) do
    %{
      "board" => request["board"],
      "class_level" => request["class_level"],
      "subject" => request["subject"],
      "chapter" => request["chapter"],
      "topic" => request["topic"],
      "duration_minutes" => request["duration_minutes"],
      "source" => request["source"],
      "difficulty" => request["difficulty"],
      "total_marks" => request["total_marks"]
    }
  end

  defp title_from_metadata(metadata, index) do
    board = metadata["board"] || "CBSE"
    class_level = metadata["class_level"] || "10"
    subject = metadata["subject"] || "Maths"
    "#{board} Class #{class_level} #{subject} Question Paper #{index}"
  end

  defp int_value(value, _default) when is_integer(value), do: value

  defp int_value(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {number, _} -> number
      :error -> default
    end
  end

  defp int_value(_value, default), do: default

  defp option_text(%{"text" => text}), do: strip_option_label(text)
  defp option_text(%{text: text}), do: strip_option_label(text)
  defp option_text(option), do: strip_option_label(option)

  defp strip_option_label(value) do
    value
    |> safe_text("")
    |> String.replace(~r/^\s*\(?[A-D]\)?[.)]?\s*/i, "")
  end

  defp validate_generation(%{"variants" => variants}, request) do
    target_marks = int_value(request["total_marks"], 0)
    target_variants = int_value(request["variant_count"], 1)

    cond do
      variants == [] ->
        {:error, :generation_returned_no_variants}

      length(variants) != target_variants ->
        {:error, :generation_variant_count_mismatch}

      Enum.any?(variants, &(get_in(&1, ["sections"]) in [nil, []])) ->
        {:error, :generation_returned_no_sections}

      Enum.any?(variants, &(get_in(&1, ["summary", "total_marks"]) != target_marks)) ->
        {:error, :generation_marks_mismatch}

      true ->
        :ok
    end
  end

  defp validate_generation(_normalized, _request), do: {:error, :invalid_generation_response}

  defp blank_question?(question) do
    text = question["text"] |> safe_text("") |> String.trim()
    String.length(text) < 12 or Regex.match?(~r/^[A-D]\.\s+/i, text)
  end

  defp safe_text(nil, default), do: default
  defp safe_text(value, _default) when is_binary(value), do: value
  defp safe_text(value, _default) when is_atom(value), do: to_string(value)
  defp safe_text(value, _default) when is_integer(value), do: Integer.to_string(value)
  defp safe_text(value, _default) when is_float(value), do: Float.to_string(value)

  defp safe_text(value, default) when is_list(value) do
    value
    |> Enum.map(&safe_text(&1, ""))
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
    |> case do
      "" -> default
      text -> text
    end
  end

  defp safe_text(value, default) when is_map(value) do
    value["citation"] || value[:citation] || value["text"] || value[:text] || value["title"] ||
      value[:title] || encode_text(value, default)
  end

  defp safe_text(value, _default), do: inspect(value)

  defp encode_text(value, default) do
    case Jason.encode(value) do
      {:ok, encoded} -> encoded
      {:error, _error} -> default
    end
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
      "difficulty",
      "total_marks",
      "duration_minutes",
      "variant_count"
    ])
  end

  defp gemini_tools do
    [
      tool("search_ncert", "Search owned NCERT chunks", search_schema()),
      tool("search_pyq", "Search owned PYQ questions", search_schema()),
      tool(
        "search_question_bank",
        "Search teacher-saved reusable question bank items",
        search_schema()
      ),
      tool("get_marking_scheme", "Fetch board-specific marking scheme", %{
        type: "object",
        properties: %{
          board: %{type: "string"},
          class_level: %{type: "string"},
          subject: %{type: "string"},
          exam_type: %{type: "string"}
        },
        required: ["board", "class_level", "subject", "exam_type"]
      }),
      tool(
        "retrieve_template",
        "Extract missing params and formatting details from an optional user template object",
        %{
          type: "object",
          properties: %{template: %{type: "object"}},
          required: ["template"]
        }
      ),
      tool("validate_paper", "Validate paper constraints", %{
        type: "object",
        properties: %{paper_json: %{type: "object"}, target_constraints: %{type: "object"}},
        required: ["paper_json", "target_constraints"]
      }),
      tool("rebalance_paper", "Rebalance marks and question types", %{
        type: "object",
        properties: %{
          paper_json: %{type: "object"},
          target_marks: %{type: "integer"},
          difficulty_mix: %{type: "string"},
          question_types: %{type: "array", items: %{type: "string"}}
        },
        required: ["paper_json", "target_marks", "question_types"]
      })
    ]
  end

  defp search_schema do
    %{
      type: "object",
      properties: %{
        board: %{type: "string"},
        class_level: %{type: "string"},
        subject: %{type: "string"},
        chapter: %{type: "string"},
        chapters: %{type: "array", items: %{type: "string"}},
        topic: %{type: "string"},
        chapter_scope: %{type: "string"},
        query: %{type: "string"},
        limit: %{type: "integer"}
      },
      required: ["query", "limit"]
    }
  end

  defp question_schema do
    %{
      type: "object",
      properties: %{
        id: %{type: "string"},
        text: %{type: "string"},
        richText: %{type: "string"},
        options: %{
          type: "array",
          items: %{
            type: "object",
            properties: %{
              label: %{type: "string"},
              text: %{type: "string"},
              richText: %{type: "string"},
              isCorrect: %{type: "boolean"}
            }
          }
        },
        subparts: %{
          type: "array",
          items: %{
            type: "object",
            properties: %{
              id: %{type: "string"},
              label: %{type: "string"},
              text: %{type: "string"},
              richText: %{type: "string"},
              marks: %{type: "integer"},
              answer: %{type: "string"},
              answerRichText: %{type: "string"},
              optionalChoice: %{type: "object"}
            }
          }
        },
        optionalChoice: %{type: "object"},
        marks: %{type: "integer"},
        type: %{type: "string"},
        difficulty: %{type: "string"},
        source: %{type: "string"},
        topic: %{type: "string"},
        answer: %{type: "string"},
        answerRichText: %{type: "string"},
        tags: %{type: "array", items: %{type: "string"}}
      }
    }
  end

  defp tool(name, description, parameters),
    do: %{name: name, description: description, parameters: parameters}

  defp api_key,
    do: Application.get_env(:qpg, Qpg.AI.Gemini, [])[:api_key] || System.get_env("GEMINI_API_KEY")

  defp model_for(:small), do: System.get_env("GEMINI_SMALL_MODEL", "gemini-2.5-flash")
  defp model_for(_), do: System.get_env("GEMINI_MODEL", "gemini-2.5-flash")

  defp model_for(:generation, request) do
    if Map.get(request, "total_marks", 0) >= 100 or Map.get(request, "variant_count", 1) > 5 do
      System.get_env("GEMINI_LARGE_MODEL", "gemini-2.5-pro")
    else
      System.get_env("GEMINI_MODEL", "gemini-2.5-flash")
    end
  end

  defp model_for(:post_generation_fix, instruction) do
    if whole_rewrite?(instruction),
      do: System.get_env("GEMINI_LARGE_MODEL", "gemini-2.5-pro"),
      else: System.get_env("GEMINI_SMALL_MODEL", "gemini-2.5-flash")
  end

  defp whole_rewrite?(instruction) do
    lower = String.downcase(instruction || "")

    Enum.any?(
      ["rewrite whole", "entire paper", "full rewrite", "regenerate all", "change everything"],
      &String.contains?(lower, &1)
    )
  end

  defp gemini_schema(schema) do
    schema
    |> strip_schema_keys()
    |> stringify_types()
  end

  defp strip_schema_keys(map) when is_map(map) do
    map
    |> Map.drop([:additionalProperties, "additionalProperties"])
    |> Enum.map(fn {key, value} -> {key, strip_schema_keys(value)} end)
    |> Map.new()
  end

  defp strip_schema_keys(list) when is_list(list), do: Enum.map(list, &strip_schema_keys/1)
  defp strip_schema_keys(value), do: value

  defp stringify_types(%{type: types} = map) when is_list(types),
    do: %{map | type: types |> Enum.reject(&(&1 == "null")) |> List.first("string")}

  defp stringify_types(map) when is_map(map),
    do: Map.new(map, fn {key, value} -> {key, stringify_types(value)} end)

  defp stringify_types(list) when is_list(list), do: Enum.map(list, &stringify_types/1)
  defp stringify_types(value), do: value

  defp paper_request_schema do
    %{
      type: "object",
      properties: %{
        board: %{type: "string"},
        class_level: %{type: "string"},
        subject: %{type: "string"},
        chapter_scope: %{type: "string"},
        chapter: %{type: "string"},
        chapters: %{type: "array", items: %{type: "string"}},
        topic: %{type: "string"},
        source: %{type: "string"},
        question_types: %{type: "array", items: %{type: "string"}},
        section_blueprint: %{
          type: "array",
          items: %{
            type: "object",
            properties: %{
              id: %{type: "string"},
              title: %{type: "string"},
              question_types: %{type: "array", items: %{type: "string"}},
              question_count: %{type: "integer"},
              marks_each: %{type: "integer"},
              difficulty: %{type: "string"},
              instructions: %{type: "string"}
            }
          }
        },
        marking_scheme: %{type: "string"},
        difficulty: %{type: "string"},
        total_marks: %{type: "integer"},
        duration_minutes: %{type: "integer"},
        variant_count: %{type: "integer"}
      }
    }
  end
end
