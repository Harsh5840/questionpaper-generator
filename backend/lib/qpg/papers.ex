defmodule Qpg.Papers do
  import Ecto.Query

  alias Qpg.Logging
  alias Qpg.Repo
  alias Qpg.Papers.{Export, Paper, PaperQuestion, PaperQuestionOption, PaperSection, PaperVersion}

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

  def get_structured_paper!(id) do
    paper = get_paper!(id)
    latest_version = List.first(paper.versions || [])

    payload =
      case latest_version do
        nil -> %{}
        version -> structured_payload_for_version(version) || version.payload || %{}
      end

    Logging.info("papers.structured.get.completed", %{
      paper_id: id,
      version_id: latest_version && latest_version.id,
      section_count: payload |> Map.get("sections", []) |> List.wrap() |> length()
    })

    %{paper: paper, version: latest_version, payload: payload}
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
    payload = normalize_payload_inline_options(payload)

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

    result =
      Repo.transaction(fn ->
        version =
          %PaperVersion{}
          |> PaperVersion.changeset(%{
            paper_id: paper.id,
            version_number: next_version,
            change_source: change_source,
            payload: payload,
            marks_total: get_in(payload, ["summary", "total_marks"]) || payload["total_marks"]
          })
          |> Repo.insert!()

        sync_version_structure!(paper, version, payload)
        version
      end)

    case result do
      {:ok, version} ->
        Logging.info("papers.version.create.completed", %{
          paper_id: paper.id,
          version_id: version.id,
          version_number: version.version_number,
          marks_total: version.marks_total
        })

        {:ok, version}

      {:error, reason} ->
        Logging.error("papers.version.create.failed", %{
          paper_id: paper.id,
          error: inspect(reason)
        })

        {:error, reason}
    end
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

  defp structured_payload_for_version(%PaperVersion{} = version) do
    sections =
      PaperSection
      |> where([s], s.paper_version_id == ^version.id)
      |> order_by([s], asc: s.position)
      |> Repo.all()

    if sections == [] do
      nil
    else
      questions =
        PaperQuestion
        |> where([q], q.paper_version_id == ^version.id)
        |> order_by([q], asc: q.position)
        |> preload(:options)
        |> Repo.all()

      questions_by_section = Enum.group_by(questions, & &1.paper_section_id)
      questions_by_parent = Enum.group_by(questions, & &1.parent_question_id)

      version.payload
      |> normalize_payload_inline_options()
      |> Map.put(
        "sections",
        Enum.map(sections, fn section ->
          serialize_structured_section(
            section,
            Map.get(questions_by_section, section.id, []),
            questions_by_parent
          )
        end)
      )
    end
  end

  defp serialize_structured_section(section, section_questions, questions_by_parent) do
    root_questions =
      section_questions
      |> Enum.filter(&(&1.relation_type == "root"))
      |> Enum.sort_by(& &1.position)
      |> Enum.map(&serialize_structured_question(&1, questions_by_parent))

    %{
      "id" => section.section_key || section.id,
      "title" => section.title,
      "instructions" => section.instructions || "",
      "difficulty" => section.difficulty,
      "targetMarks" => section.target_marks,
      "questions" => root_questions
    }
  end

  defp serialize_structured_question(question, questions_by_parent) do
    children = Map.get(questions_by_parent, question.id, [])

    subparts =
      children
      |> Enum.filter(&(&1.relation_type == "subpart"))
      |> Enum.sort_by(& &1.position)
      |> Enum.map(&serialize_structured_subpart(&1, questions_by_parent))

    internal_choice =
      children
      |> Enum.find(&(&1.relation_type == "internal_choice"))
      |> case do
        nil -> nil
        choice -> serialize_structured_choice(choice, questions_by_parent)
      end

    question
    |> base_question_payload()
    |> Map.put("options", serialize_structured_options(question.options || []))
    |> put_if_present("subparts", subparts)
    |> put_if_present("optionalChoice", internal_choice)
  end

  defp serialize_structured_subpart(question, questions_by_parent) do
    subpart_choice =
      questions_by_parent
      |> Map.get(question.id, [])
      |> Enum.find(&(&1.relation_type == "subpart_choice"))
      |> case do
        nil -> nil
        choice -> serialize_structured_choice(choice, questions_by_parent)
      end

    question
    |> base_question_payload()
    |> Map.put("label", question.part_label)
    |> Map.put("options", serialize_structured_options(question.options || []))
    |> put_if_present("optionalChoice", subpart_choice)
  end

  defp serialize_structured_choice(question, _questions_by_parent) do
    question
    |> base_question_payload()
    |> Map.put("options", serialize_structured_options(question.options || []))
  end

  defp base_question_payload(question) do
    %{
      "id" => question.question_key || question.id,
      "text" => question.text || "",
      "richText" => question.rich_text || "",
      "marks" => question.marks || 0,
      "type" => question.question_type || "",
      "difficulty" => question.difficulty || "",
      "source" => question.source || "",
      "topic" => question.topic,
      "answer" => question.answer || "",
      "answerRichText" => question.answer_rich_text || "",
      "sourceCitations" => question.source_citations || [],
      "tags" => question.tags || []
    }
  end

  defp serialize_structured_options(options) do
    options
    |> Enum.sort_by(& &1.position)
    |> Enum.map(fn option ->
      %{
        "id" => option.id,
        "label" => option.label,
        "text" => option.text || "",
        "richText" => option.rich_text || "",
        "isCorrect" => option.is_correct || false
      }
    end)
  end

  defp put_if_present(map, _key, nil), do: map
  defp put_if_present(map, _key, []), do: map
  defp put_if_present(map, key, value), do: Map.put(map, key, value)

  defp sync_version_structure!(%Paper{} = paper, %PaperVersion{} = version, payload)
       when is_map(payload) do
    version_question_ids =
      from(q in PaperQuestion, where: q.paper_version_id == ^version.id, select: q.id)

    Repo.delete_all(
      from(o in PaperQuestionOption, where: o.paper_question_id in subquery(version_question_ids))
    )

    Repo.delete_all(from(q in PaperQuestion, where: q.paper_version_id == ^version.id))
    Repo.delete_all(from(s in PaperSection, where: s.paper_version_id == ^version.id))

    payload
    |> value(["sections"], [])
    |> List.wrap()
    |> Enum.with_index(1)
    |> Enum.reduce(1, fn {section_payload, section_position}, next_question_number ->
      section = insert_section!(paper, version, section_payload, section_position)

      section_payload
      |> value(["questions"], [])
      |> List.wrap()
      |> Enum.with_index()
      |> Enum.reduce(next_question_number, fn {question_payload, question_position},
                                              question_number ->
        root =
          insert_question!(paper, version, section, question_payload, %{
            position: question_position + 1,
            question_number: Integer.to_string(question_number),
            relation_type: "root"
          })

        insert_options!(root, question_payload)
        insert_child_questions!(paper, version, section, root, question_payload, question_number)

        question_number + 1
      end)
    end)
  end

  defp sync_version_structure!(_paper, _version, _payload), do: :ok

  defp normalize_payload_inline_options(payload) when is_map(payload) do
    Map.update(payload, "sections", [], fn sections ->
      sections
      |> List.wrap()
      |> Enum.map(fn section ->
        if is_map(section) do
          Map.update(section, "questions", [], fn questions ->
            questions
            |> List.wrap()
            |> Enum.map(&normalize_question_inline_options/1)
          end)
        else
          section
        end
      end)
    end)
  end

  defp normalize_payload_inline_options(payload), do: payload

  defp normalize_question_inline_options(question) when is_map(question) do
    provided_options = question |> value(["options"], []) |> List.wrap()

    if provided_options == [] do
      case split_inline_options(value(question, ["text"], "")) do
        nil ->
          question

        %{stem: stem, options: options} ->
          question
          |> Map.put("text", stem)
          |> Map.put("richText", "")
          |> Map.put("options", options)
      end
    else
      question
    end
    |> Map.update("subparts", [], fn subparts ->
      subparts
      |> List.wrap()
      |> Enum.map(&normalize_question_inline_options/1)
    end)
    |> Map.update("optionalChoice", nil, fn
      choice when is_map(choice) -> normalize_question_inline_options(choice)
      choice -> choice
    end)
  end

  defp normalize_question_inline_options(question), do: question

  defp split_inline_options(text) when is_binary(text) do
    options = extract_inline_options(text)

    if length(options) < 2 do
      nil
    else
      first =
        Regex.run(
          ~r/(?:^|\s)(\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[A-D])\)|[A-D][.)])\s*/iu,
          text,
          return: :index
        )

      case first do
        [{start, _length} | _] ->
          %{stem: text |> String.slice(0, start) |> String.trim(), options: options}

        _ ->
          nil
      end
    end
  end

  defp split_inline_options(_text), do: nil

  defp insert_section!(paper, version, section_payload, position) do
    %PaperSection{}
    |> PaperSection.changeset(%{
      paper_id: paper.id,
      paper_version_id: version.id,
      section_key: value(section_payload, ["id", "key", "section_key"], "section-#{position}"),
      position: position,
      title: value(section_payload, ["title", "label"], "Section #{position}"),
      instructions: value(section_payload, ["instructions"], nil),
      difficulty:
        value(section_payload, ["difficulty", "sectionDifficulty", "section_difficulty"], nil),
      target_marks:
        int_value(section_payload, ["targetMarks", "target_marks", "total_marks"], nil),
      payload: section_payload
    })
    |> Repo.insert!()
  end

  defp insert_child_questions!(paper, version, section, root, question_payload, question_number) do
    question_payload
    |> value(["subparts", "sub_parts"], [])
    |> List.wrap()
    |> Enum.with_index(1)
    |> Enum.each(fn {subpart_payload, subpart_position} ->
      subpart =
        insert_question!(paper, version, section, subpart_payload, %{
          parent_question_id: root.id,
          position: subpart_position,
          question_number: "#{question_number}.#{subpart_position}",
          part_label: value(subpart_payload, ["label"], Integer.to_string(subpart_position)),
          relation_type: "subpart"
        })

      insert_options!(subpart, subpart_payload)

      case value(subpart_payload, ["optionalChoice", "optional_choice"], nil) do
        choice when is_map(choice) ->
          choice_question =
            insert_question!(paper, version, section, choice, %{
              parent_question_id: subpart.id,
              position: 1,
              question_number: "#{question_number}.#{subpart_position}",
              part_label: value(subpart_payload, ["label"], Integer.to_string(subpart_position)),
              relation_type: "subpart_choice",
              choice_group: "or"
            })

          insert_options!(choice_question, choice)

        _ ->
          :ok
      end
    end)

    case value(question_payload, ["optionalChoice", "optional_choice"], nil) do
      choice when is_map(choice) ->
        choice_question =
          insert_question!(paper, version, section, choice, %{
            parent_question_id: root.id,
            position: 1,
            question_number: Integer.to_string(question_number),
            relation_type: "internal_choice",
            choice_group: "or"
          })

        insert_options!(choice_question, choice)

      _ ->
        :ok
    end
  end

  defp insert_question!(paper, version, section, question_payload, attrs) do
    %PaperQuestion{}
    |> PaperQuestion.changeset(%{
      paper_id: paper.id,
      paper_version_id: version.id,
      paper_section_id: section.id,
      parent_question_id: attrs[:parent_question_id],
      question_key: value(question_payload, ["id", "key", "question_key"], nil),
      position: attrs[:position],
      question_number: attrs[:question_number],
      part_label: attrs[:part_label],
      relation_type: attrs[:relation_type],
      choice_group: attrs[:choice_group],
      question_type: value(question_payload, ["type", "question_type"], nil),
      marks: int_value(question_payload, ["marks"], 0),
      difficulty: value(question_payload, ["difficulty"], nil),
      source: value(question_payload, ["source"], nil),
      topic: value(question_payload, ["topic"], nil),
      text: value(question_payload, ["text"], ""),
      rich_text: value(question_payload, ["richText", "rich_text"], nil),
      answer: value(question_payload, ["answer"], nil),
      answer_rich_text: value(question_payload, ["answerRichText", "answer_rich_text"], nil),
      source_citations: list_value(question_payload, ["sourceCitations", "source_citations"]),
      tags: list_value(question_payload, ["tags"]),
      payload: question_payload
    })
    |> Repo.insert!()
  end

  defp insert_options!(%PaperQuestion{} = question, question_payload) do
    options =
      question_payload
      |> value(["options"], [])
      |> List.wrap()
      |> case do
        [] -> extract_inline_options(value(question_payload, ["text"], ""))
        provided_options -> provided_options
      end

    options
    |> Enum.with_index(1)
    |> Enum.each(fn {option_payload, position} ->
      option = option_map(option_payload, position)

      %PaperQuestionOption{}
      |> PaperQuestionOption.changeset(Map.put(option, :paper_question_id, question.id))
      |> Repo.insert!()
    end)
  end

  defp option_map(option, position) when is_map(option) do
    %{
      position: position,
      label: value(option, ["label"], option_label(position)),
      text: value(option, ["text", "value"], ""),
      rich_text: value(option, ["richText", "rich_text"], nil),
      is_correct: option["is_correct"] || option["isCorrect"] || false,
      payload: option
    }
  end

  defp option_map(option, position) do
    %{
      position: position,
      label: option_label(position),
      text: to_string(option || ""),
      payload: %{"text" => to_string(option || "")}
    }
  end

  defp option_label(position), do: <<64 + position::utf8>>

  defp extract_inline_options(text) when is_binary(text) do
    option_pattern =
      ~r/(?:^|\s)(\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[A-D])\)|[A-D][.)])\s*(.*?)(?=\s+(?:\((?:i{1,3}|iv|v|vi{0,3}|ix|x|[A-D])\)|[A-D][.)])\s*|$)/iu

    matches = Regex.scan(option_pattern, text)

    if length(matches) < 2 do
      []
    else
      Enum.map(matches, fn [_full, label, option_text] ->
        %{
          "label" => String.trim(label),
          "text" => String.trim(option_text)
        }
      end)
    end
  end

  defp extract_inline_options(_text), do: []

  defp value(map, keys, default) when is_map(map) do
    Enum.find_value(keys, default, fn key ->
      case Map.get(map, key) do
        nil -> false
        value -> value
      end
    end)
  end

  defp value(_map, _keys, default), do: default

  defp int_value(map, keys, default) do
    case value(map, keys, default) do
      value when is_integer(value) ->
        value

      value when is_float(value) ->
        round(value)

      value when is_binary(value) ->
        case Integer.parse(value) do
          {number, _} -> number
          :error -> default
        end

      _ ->
        default
    end
  end

  defp list_value(map, keys) do
    map
    |> value(keys, [])
    |> List.wrap()
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&to_string/1)
  end
end
