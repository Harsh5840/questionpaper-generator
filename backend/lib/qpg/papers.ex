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
