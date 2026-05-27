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

  def refine_payload(paper_payload, instruction, paper_id \\ nil) do
    Logging.info("ai.orchestrator.refine_payload.started", %{
      provider: inspect(Provider.active()),
      paper_id: paper_id,
      instruction: instruction,
      has_sections: is_list(paper_payload["sections"])
    })

    case maybe_replace_question(paper_payload, instruction, paper_id) do
      {:ok, response} ->
        response

      :skip ->
        refine_payload_with_provider(paper_payload, instruction, paper_id)
    end
  end

  defp refine_payload_with_provider(paper_payload, instruction, paper_id) do
    refinement_input = %{"id" => paper_id, "current_paper" => paper_payload}

    case safe_refine_bundle(refinement_input, instruction) do
      {:ok, response} when is_map(response) ->
        response = normalize_refinement_response(response, paper_payload)
        patch_ops = Map.get(response, "patch_ops", [])
        response = ensure_preview(response, paper_payload, patch_ops)

        Logging.info("ai.orchestrator.refine_payload.completed", %{
          paper_id: paper_id,
          patch_count: length(List.wrap(patch_ops))
        })

        response

      {:error, reason} ->
        Logging.error("ai.orchestrator.refine_payload.failed", %{paper_id: paper_id, reason: reason})
        raise "AI refinement failed: #{format_error(reason)}"
    end
  end

  defp maybe_replace_question(paper_payload, instruction, paper_id) do
    with true <- replace_instruction?(instruction),
         {:ok, question_number} <- question_number_from_instruction(instruction),
         {:ok, target} <- question_at_global_number(paper_payload, question_number),
         {:ok, replacement} <- generate_replacement_question(paper_payload, target) do
      choice_replacement? = optional_choice_instruction?(instruction)
      replacement_path = replacement_path(target, choice_replacement?)
      replacement_value = replacement_value(replacement, target.question, choice_replacement?)
      preview = put_json_pointer(paper_payload, replacement_path, replacement_value)

      Logging.info("ai.orchestrator.replace_question.completed", %{
        paper_id: paper_id,
        question_number: question_number,
        optional_choice: choice_replacement?,
        path: "/" <> Enum.join(replacement_path, "/")
      })

      {:ok,
       %{
         "message" => replacement_message(question_number, choice_replacement?),
         "base_version_id" => "",
         "patch_ops" => [
           %{
             "op" => "replace",
             "path" => "/" <> Enum.join(replacement_path, "/"),
             "value" => replacement_value
           }
         ],
         "preview" => preview
       }}
    else
      false -> :skip
      {:error, reason} ->
        Logging.warning("ai.orchestrator.replace_question.skipped", %{reason: inspect(reason)})
        :skip
    end
  end

  defp replace_instruction?(instruction) do
    lower = String.downcase(instruction || "")
    String.contains?(lower, "replace") or String.contains?(lower, "change")
  end

  defp optional_choice_instruction?(instruction) do
    lower = String.downcase(instruction || "")

    String.contains?(lower, "optionalchoice") or
      String.contains?(lower, "optional choice") or
      String.contains?(lower, "internal choice") or
      String.contains?(lower, "or choice") or
      Regex.match?(~r/\bor\b/, lower)
  end

  defp replacement_path(target, true), do: target.path ++ ["optionalChoice"]
  defp replacement_path(target, false), do: target.path

  defp replacement_message(question_number, true), do: "Replaced OR choice for question #{question_number}."
  defp replacement_message(question_number, false), do: "Replaced question #{question_number}."

  defp replacement_value(replacement, original_question, true) do
    %{
      "id" => Ecto.UUID.generate(),
      "text" => replacement["text"] || "",
      "richText" => replacement["richText"] || replacement["rich_text"] || "",
      "marks" => replacement["marks"] || original_question["marks"] || 1,
      "type" => replacement["type"] || replacement["question_type"] || original_question["type"] || "SA",
      "difficulty" => replacement["difficulty"] || original_question["difficulty"] || "Medium",
      "source" => replacement["source"] || "AI replacement",
      "topic" => replacement["topic"] || original_question["topic"],
      "tags" => replacement["tags"] || original_question["tags"] || [],
      "answer" => replacement["answer"] || "",
      "answerRichText" => replacement["answerRichText"] || replacement["answer_rich_text"] || ""
    }
  end

  defp replacement_value(replacement, _original_question, false), do: replacement

  defp question_number_from_instruction(instruction) do
    lower = String.downcase(instruction || "")

    cond do
      lower =~ ~r/\bfirst\s+ques/ -> {:ok, 1}
      lower =~ ~r/\bsecond\s+ques/ -> {:ok, 2}
      lower =~ ~r/\bthird\s+ques/ -> {:ok, 3}
      match = Regex.run(~r/(?:global\s+)?q(?:uestion)?\s*\.?\s*(\d+)/, lower) -> {:ok, match |> List.last() |> String.to_integer()}
      match = Regex.run(~r/\b(\d+)(?:st|nd|rd|th)?\s+ques/, lower) -> {:ok, match |> List.last() |> String.to_integer()}
      true -> {:error, :missing_question_number}
    end
  end

  defp question_at_global_number(%{"sections" => sections}, question_number) when is_list(sections) do
    sections
    |> Enum.with_index()
    |> Enum.reduce_while(1, fn {section, section_index}, count ->
      questions = List.wrap(section["questions"])

      case find_question_in_section(questions, section_index, question_number, count) do
        {:ok, target} -> {:halt, {:found, target}}
        {:cont, next_count} -> {:cont, next_count}
      end
    end)
    |> case do
      {:found, target} -> {:ok, target}
      _ -> {:error, :question_not_found}
    end
  end

  defp question_at_global_number(_paper, _number), do: {:error, :missing_sections}

  defp find_question_in_section(questions, section_index, target_number, start_count) do
    questions
    |> Enum.with_index()
    |> Enum.reduce_while(start_count, fn {question, question_index}, count ->
      if count == target_number do
        {:halt,
         {:ok,
          %{
            path: ["sections", Integer.to_string(section_index), "questions", Integer.to_string(question_index)],
            question: question
          }}}
      else
        {:cont, count + 1}
      end
    end)
    |> case do
      {:ok, target} -> {:ok, target}
      next_count -> {:cont, next_count}
    end
  end

  defp generate_replacement_question(paper_payload, %{question: question}) do
    metadata = Map.get(paper_payload, "metadata", %{})
    marks = int_value(question["marks"], 1)
    question_type = question["type"] || question["question_type"] || "SA"
    chapter = metadata["chapter"] || question["topic"] || metadata["topic"] || ""

    request = %{
      "board" => metadata["board"] || "CBSE",
      "class_level" => metadata["class_level"] || metadata["classLevel"] || "10",
      "subject" => metadata["subject"] || "Maths",
      "chapter_scope" => "single",
      "chapter" => chapter,
      "chapters" => [chapter],
      "topic" => question["topic"] || metadata["topic"] || chapter,
      "source" => metadata["source"] || "NCERT + PYQ",
      "difficulty" => question["difficulty"] || "Medium",
      "question_types" => [question_type],
      "marking_scheme" => "Generate one replacement question only",
      "total_marks" => marks,
      "duration_minutes" => 10,
      "variant_count" => 1,
      "template" => nil,
      "template_context" => %{}
    }

    case safe_generate_bundle(request) do
      {:ok, %{"variants" => [variant | _]}} ->
        replacement =
          variant
          |> Map.get("sections", [])
          |> List.wrap()
          |> Enum.flat_map(&List.wrap(&1["questions"]))
          |> Enum.find(&is_map/1)

        if replacement do
          {:ok,
           replacement
           |> Map.put("id", question["id"] || Ecto.UUID.generate())
           |> Map.put("marks", marks)
           |> Map.put("type", question_type)
           |> Map.put("difficulty", question["difficulty"] || replacement["difficulty"] || "Medium")}
        else
          {:error, :missing_replacement_question}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp int_value(value, _default) when is_integer(value), do: value

  defp int_value(value, default) do
    case Integer.parse(to_string(value || "")) do
      {number, _} -> number
      :error -> default
    end
  end

  defp normalize_refinement_response(%{"patch_ops" => _} = response, _paper_payload), do: response

  defp normalize_refinement_response(%{"paper" => %{"current_paper" => preview}} = response, _paper_payload)
       when is_map(preview) do
    %{
      "message" => response["message"] || "Replaced the requested question.",
      "base_version_id" => response["base_version_id"] || "",
      "patch_ops" => [],
      "preview" => preview
    }
  end

  defp normalize_refinement_response(%{"current_paper" => preview} = response, _paper_payload)
       when is_map(preview) do
    %{
      "message" => response["message"] || "Updated the paper.",
      "base_version_id" => response["base_version_id"] || "",
      "patch_ops" => [],
      "preview" => preview
    }
  end

  defp normalize_refinement_response(%{"sections" => sections} = preview, _paper_payload)
       when is_list(sections) do
    %{
      "message" => "Updated the paper.",
      "base_version_id" => "",
      "patch_ops" => [],
      "preview" => preview
    }
  end

  defp normalize_refinement_response(response, paper_payload) do
    Logging.warning("ai.orchestrator.refine_payload.unexpected_shape", %{
      keys: Map.keys(response)
    })

    %{
      "message" => response["message"] || "No paper changes were returned by the AI provider.",
      "base_version_id" => response["base_version_id"] || "",
      "patch_ops" => List.wrap(response["patch_ops"]),
      "preview" => paper_payload
    }
  end

  def apply_patch_preview(payload, patch_ops) do
    # This preview is intentionally small in v1. Logs make it clear when an AI
    # patch was ignored because we have not implemented that operation yet.
    Logging.info("ai.orchestrator.patch_preview.started", %{
      patch_count: length(patch_ops),
      operations: Enum.map(patch_ops, &Map.take(&1, [:op, "op", :path, "path"]))
    })

    Enum.reduce(patch_ops, payload, &apply_patch_op/2)
  end

  defp ensure_preview(%{"preview" => preview} = response, _payload, _patch_ops)
       when is_map(preview) and map_size(preview) > 0,
       do: response

  defp ensure_preview(response, payload, patch_ops) do
    Map.put(response, "preview", apply_patch_preview(payload, List.wrap(patch_ops)))
  end

  defp apply_patch_op(%{"op" => op, "path" => path, "value" => value}, acc),
    do: apply_patch_op(%{op: op, path: path, value: value}, acc)

  defp apply_patch_op(%{op: "replace", path: path, value: value}, acc) when is_binary(path),
    do: put_json_pointer(acc, pointer_parts(path), value)

  defp apply_patch_op(%{op: "add", path: path, value: value}, acc) when is_binary(path),
    do: add_json_pointer(acc, pointer_parts(path), value)

  defp apply_patch_op(_op, acc), do: acc

  defp pointer_parts(path) do
    path
    |> String.trim_leading("/")
    |> String.split("/", trim: true)
    |> Enum.map(&String.replace(&1, "~1", "/"))
    |> Enum.map(&String.replace(&1, "~0", "~"))
  end

  defp put_json_pointer(_value, [], replacement), do: replacement

  defp put_json_pointer(map, [key], value) when is_map(map), do: Map.put(map, key, value)

  defp put_json_pointer(list, [index], value) when is_list(list) do
    case Integer.parse(index) do
      {position, ""} -> List.replace_at(list, position, value)
      _ -> list
    end
  end

  defp put_json_pointer(map, [key | rest], value) when is_map(map) do
    Map.put(map, key, put_json_pointer(Map.get(map, key, %{}), rest, value))
  end

  defp put_json_pointer(list, [index | rest], value) when is_list(list) do
    case Integer.parse(index) do
      {position, ""} ->
        List.update_at(list, position, &put_json_pointer(&1, rest, value))

      _ ->
        list
    end
  end

  defp put_json_pointer(value, _parts, _replacement), do: value

  defp add_json_pointer(map, ["warnings", "-"], value) when is_map(map),
    do: Map.update(map, "warnings", [value], &(&1 ++ [value]))

  defp add_json_pointer(map, path, value), do: put_json_pointer(map, path, value)

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
