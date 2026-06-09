defmodule Qpg.Assignments do
  @moduledoc """
  Prod-aligned persistence for question papers (2 tables, one tree).

    * `assignments`           — one row per paper.
    * `assignment_questions`  — the whole body as a tree linked by `parent_id`.
                                Rich text + options live in `body_store` (jsonb).

  This context speaks the SAME nested "Paper JSON" payload the rest of the app
  already uses (sections -> questions -> options/subparts/optionalChoice), so it
  can flatten that payload into the tree on write and rebuild it on read without
  changing the API contract.

  Phase 1 runs additively next to the legacy `Qpg.Papers`; nothing here touches
  the legacy tables. `source_paper_id` ties an assignment back to its legacy
  paper so backfill / dual-write is idempotent.
  """
  import Ecto.Query

  alias Qpg.Repo
  alias Qpg.Assignments.{Assignment, AssignmentQuestion}

  # ── Reads ──────────────────────────────────────────────────────────────────

  def get_assignment(id), do: Repo.get(Assignment, id)

  def get_by_source_paper(paper_id) do
    Repo.get_by(Assignment, source_paper_id: paper_id)
  end

  @doc "Rebuild the nested Paper JSON payload from the stored tree."
  def rebuild_payload(%Assignment{} = assignment) do
    rows =
      AssignmentQuestion
      |> where([q], q.assignment_id == ^assignment.id)
      |> order_by([q], asc: q.sort_order)
      |> Repo.all()

    by_parent = Enum.group_by(rows, & &1.parent_id)
    sections = Enum.filter(rows, &(&1.question_type == "section"))

    %{
      "id" => assignment.id,
      "title" => assignment.title,
      "metadata" => %{
        "board" => assignment.board_code,
        "classLevel" => assignment.class_level,
        "subject" => assignment.subject
      },
      "summary" => %{"totalMarks" => assignment.total_marks},
      "sections" => Enum.map(sections, &rebuild_section(&1, by_parent))
    }
  end

  def rebuild_payload(id) when is_binary(id) do
    case get_assignment(id) do
      nil -> nil
      assignment -> rebuild_payload(assignment)
    end
  end

  defp rebuild_section(section, by_parent) do
    children = Map.get(by_parent, section.id, [])
    # Root questions = direct children that are not OR-alternatives.
    roots = children |> Enum.reject(& &1.is_or_alternative) |> Enum.sort_by(& &1.sort_order)
    or_alts = Enum.filter(children, & &1.is_or_alternative)

    %{
      "id" => section.source_question_key || section.id,
      "title" => section.section_label || body(section, "section_label") || "",
      "instructions" => body(section, "instructions") || "",
      "attemptRule" => body(section, "attempt_rule"),
      "questions" => Enum.map(roots, &rebuild_question(&1, by_parent, or_alts))
    }
    |> drop_nil_values()
  end

  defp rebuild_question(q, by_parent, section_or_alts) do
    children = Map.get(by_parent, q.id, [])
    subparts = children |> Enum.reject(& &1.is_or_alternative) |> Enum.sort_by(& &1.sort_order)

    # The OR-alternative for a whole question sits under the section, sharing the
    # question_number with this row.
    choice =
      Enum.find(section_or_alts, fn alt ->
        alt.question_number == q.question_number and is_nil(alt.part_label)
      end)

    base_question_map(q)
    |> Map.put("options", rebuild_options(q))
    |> put_present("subparts", Enum.map(subparts, &rebuild_subpart(&1, by_parent)))
    |> put_present("optionalChoice", choice && base_question_map(choice) |> Map.put("options", rebuild_options(choice)))
  end

  defp rebuild_subpart(sp, by_parent) do
    # A subpart's OR-alternative is a sibling row (same parent question) flagged
    # is_or_alternative with the same part_label.
    siblings = Map.get(by_parent, sp.parent_id, [])

    choice =
      Enum.find(siblings, fn alt ->
        alt.is_or_alternative and alt.part_label == sp.part_label
      end)

    base_question_map(sp)
    |> Map.put("label", sp.part_label)
    |> Map.put("options", rebuild_options(sp))
    |> put_present("optionalChoice", choice && base_question_map(choice) |> Map.put("options", rebuild_options(choice)))
  end

  defp base_question_map(q) do
    %{
      "id" => q.source_question_key || q.id,
      "text" => body(q, "question_text") || "",
      "richText" => body(q, "rich_text") || "",
      "marks" => q.marks_possible || 0,
      "type" => body(q, "ui_type") || q.question_type || "",
      "difficulty" => q.difficulty || "",
      "source" => q.source_type || "",
      "topic" => body(q, "topic"),
      "answer" => body(q, "expected_answer") || "",
      "answerRichText" => body(q, "answer_rich_text") || "",
      "sourceCitations" => body(q, "citations") || [],
      "tags" => body(q, "tags") || []
    }
  end

  defp rebuild_options(q) do
    q
    |> body("options")
    |> List.wrap()
    |> Enum.map(fn opt ->
      %{
        "id" => Map.get(opt, "id"),
        "label" => Map.get(opt, "label") || Map.get(opt, "id"),
        "text" => Map.get(opt, "text") || "",
        "richText" => Map.get(opt, "rich_text") || "",
        "isCorrect" => Map.get(opt, "is_correct") || false
      }
    end)
  end

  # ── Writes ───────────────────────────────────────────────────────────────────

  @doc """
  Create (or replace) an assignment + its question tree from a nested Paper
  JSON payload. Idempotent on `:source_paper_id`: an existing assignment for the
  same legacy paper is updated in place and its tree rebuilt.
  """
  def upsert_from_payload(payload, opts \\ []) when is_map(payload) do
    source_paper_id = Keyword.get(opts, :source_paper_id)
    metadata = Map.get(payload, "metadata", %{})

    attrs = %{
      tenant_id: Keyword.get(opts, :tenant_id),
      title: Map.get(payload, "title") || "Question Paper",
      board_code: Keyword.get(opts, :board_code) || Map.get(metadata, "board"),
      class_level: Keyword.get(opts, :class_level) || Map.get(metadata, "classLevel"),
      subject: Keyword.get(opts, :subject) || Map.get(metadata, "subject"),
      instructions: Map.get(payload, "instructions"),
      input_mode: Keyword.get(opts, :input_mode),
      status: Keyword.get(opts, :status, "draft"),
      total_marks: total_marks(payload),
      source_paper_id: source_paper_id
    }

    Repo.transaction(fn ->
      assignment =
        case source_paper_id && get_by_source_paper(source_paper_id) do
          nil -> %Assignment{}
          existing -> existing
        end
        |> Assignment.changeset(attrs)
        |> Repo.insert_or_update!()

      # Replace the tree wholesale — rows are the source of truth.
      Repo.delete_all(from(q in AssignmentQuestion, where: q.assignment_id == ^assignment.id))

      sections = payload |> Map.get("sections", []) |> List.wrap()
      insert_tree!(assignment, sections)

      assignment
    end)
  end

  defp insert_tree!(%Assignment{} = assignment, sections) do
    Enum.reduce(sections, %{sort: 0, qnum: 0}, fn section, acc ->
      {section_row, acc} = insert_section!(assignment, section, acc)
      questions = section |> val(["questions"], []) |> List.wrap()
      Enum.reduce(questions, acc, &insert_question!(assignment, section_row, section, &1, &2))
    end)
  end

  defp insert_section!(assignment, section, acc) do
    row =
      insert_row!(assignment, %{
        parent_id: nil,
        question_type: "section",
        question_number: nil,
        section_label: val(section, ["title", "label"], nil),
        part_label: nil,
        marks_possible: nil,
        sort_order: acc.sort,
        source_question_key: val(section, ["id", "key"], nil),
        is_or_alternative: false,
        difficulty: nil,
        short_prompt: val(section, ["title"], "Section"),
        source_type: nil,
        body_store: %{
          "section_label" => val(section, ["title", "label"], nil),
          "instructions" => val(section, ["instructions"], nil),
          "attempt_rule" => val(section, ["attemptRule", "attempt_rule"], nil)
        }
      })

    {row, %{acc | sort: acc.sort + 1}}
  end

  defp insert_question!(assignment, section_row, section, q, acc) do
    qnum = acc.qnum + 1
    section_label = val(section, ["title", "label"], nil)

    row =
      insert_row!(assignment, %{
        parent_id: section_row.id,
        question_type: map_type(q),
        question_number: Integer.to_string(qnum),
        section_label: section_label,
        part_label: nil,
        marks_possible: float_marks(q),
        sort_order: acc.sort,
        source_question_key: val(q, ["id", "key"], nil),
        is_or_alternative: false,
        difficulty: norm_difficulty(q),
        short_prompt: preview(q),
        source_type: norm_source(q),
        body_store: content_body(q, section_label)
      })

    acc = %{acc | sort: acc.sort + 1, qnum: qnum}

    # Sub-parts hang off the question.
    acc =
      q
      |> val(["subparts", "sub_parts"], [])
      |> List.wrap()
      |> Enum.with_index(1)
      |> Enum.reduce(acc, fn {sp, idx}, acc ->
        part_label = val(sp, ["label"], Integer.to_string(idx))

        _sp_row =
          insert_row!(assignment, %{
            parent_id: row.id,
            question_type: map_type(sp),
            question_number: Integer.to_string(qnum),
            section_label: section_label,
            part_label: part_label,
            marks_possible: float_marks(sp),
            sort_order: acc.sort,
            source_question_key: val(sp, ["id", "key"], nil),
            is_or_alternative: false,
            difficulty: norm_difficulty(sp),
            short_prompt: preview(sp),
            source_type: norm_source(sp),
            body_store: content_body(sp, section_label)
          })

        acc = %{acc | sort: acc.sort + 1}

        # A subpart's OR-alternative — sibling under the same question.
        case val(sp, ["optionalChoice", "optional_choice"], nil) do
          choice when is_map(choice) ->
            insert_or_alt!(assignment, row.id, section_label, qnum, part_label, choice, acc.sort)
            %{acc | sort: acc.sort + 1}

          _ ->
            acc
        end
      end)

    # Whole-question OR-alternative — sibling under the section.
    case val(q, ["optionalChoice", "optional_choice"], nil) do
      choice when is_map(choice) ->
        insert_or_alt!(assignment, section_row.id, section_label, qnum, nil, choice, acc.sort)
        %{acc | sort: acc.sort + 1}

      _ ->
        acc
    end
  end

  defp insert_or_alt!(assignment, parent_id, section_label, qnum, part_label, choice, sort) do
    base_key = val(choice, ["id", "key"], nil)

    insert_row!(assignment, %{
      parent_id: parent_id,
      question_type: map_type(choice),
      question_number: Integer.to_string(qnum),
      section_label: section_label,
      part_label: part_label,
      marks_possible: float_marks(choice),
      sort_order: sort,
      source_question_key: or_key(base_key),
      is_or_alternative: true,
      difficulty: norm_difficulty(choice),
      short_prompt: preview(choice),
      source_type: norm_source(choice),
      body_store: content_body(choice, section_label)
    })
  end

  defp insert_row!(%Assignment{} = assignment, attrs) do
    %AssignmentQuestion{}
    |> AssignmentQuestion.changeset(Map.put(attrs, :assignment_id, assignment.id))
    |> Repo.insert!()
  end

  # ── body_store content shape ─────────────────────────────────────────────────

  defp content_body(q, section_label) do
    %{
      "question_text" => val(q, ["text"], ""),
      "rich_text" => val(q, ["richText", "rich_text"], ""),
      "expected_answer" => val(q, ["answer"], ""),
      "answer_rich_text" => val(q, ["answerRichText", "answer_rich_text"], ""),
      "question_type" => map_type(q),
      "ui_type" => val(q, ["type", "question_type"], nil),
      "section" => section_label,
      "points_possible" => float_marks(q),
      "is_or_alternative" => false,
      "options" => content_options(q),
      "parts" => [],
      "visual_regions" => [],
      "topic" => val(q, ["topic"], nil),
      "citations" => list_val(q, ["sourceCitations", "source_citations"]),
      "tags" => list_val(q, ["tags"])
    }
  end

  defp content_options(q) do
    q
    |> val(["options"], [])
    |> List.wrap()
    |> Enum.with_index(1)
    |> Enum.map(fn {opt, idx} ->
      %{
        "id" => val(opt, ["label", "id"], <<64 + idx::utf8>>),
        "text" => val(opt, ["text", "value"], ""),
        "rich_text" => val(opt, ["richText", "rich_text"], ""),
        "is_correct" => Map.get(opt, "isCorrect") || Map.get(opt, "is_correct") || false,
        "has_visual" => Map.get(opt, "hasVisual") || Map.get(opt, "has_visual") || false
      }
    end)
  end

  # ── value helpers ──────────────────────────────────────────────────────────

  defp body(%AssignmentQuestion{body_store: store}, key) when is_map(store), do: Map.get(store, key)
  defp body(_q, _key), do: nil

  defp total_marks(payload) do
    get_in(payload, ["summary", "totalMarks"]) ||
      get_in(payload, ["summary", "total_marks"]) ||
      Map.get(payload, "total_marks") || 0
  end

  defp map_type(q) do
    raw = val(q, ["type", "question_type"], "") |> to_string()

    case String.downcase(String.trim(raw)) do
      "" -> "short_answer"
      "mcq" -> "mcq"
      "multiple choice" -> "mcq"
      "short answer" -> "short_answer"
      "very short answer" -> "short_answer"
      "long answer" -> "extended_answer"
      "extended answer" -> "extended_answer"
      "case study" -> "case_study"
      "assertion reason" -> "assertion_reason"
      "assertion_reason" -> "assertion_reason"
      "fill in the blanks" -> "fill_blank"
      "true/false" -> "true_false"
      "true false" -> "true_false"
      other -> other |> String.replace(~r/[^a-z0-9]+/, "_") |> String.trim("_")
    end
  end

  defp float_marks(q) do
    case val(q, ["marks"], nil) do
      n when is_number(n) -> n / 1
      s when is_binary(s) -> case Float.parse(s) do
                               {f, _} -> f
                               :error -> nil
                             end
      _ -> nil
    end
  end

  defp norm_difficulty(q) do
    case val(q, ["difficulty"], nil) do
      nil -> nil
      d -> d |> to_string() |> String.downcase()
    end
  end

  defp norm_source(q) do
    case val(q, ["source"], nil) do
      nil -> nil
      s -> s |> to_string() |> String.downcase()
    end
  end

  defp or_key(nil), do: nil
  defp or_key(key), do: if(String.ends_with?(key, "_or"), do: key, else: key <> "_or")

  # Plain-text preview for browsing/search without hydrating body_store.
  defp preview(q) do
    text =
      case val(q, ["text"], "") do
        "" -> val(q, ["richText", "rich_text"], "")
        t -> t
      end

    text
    |> to_string()
    |> String.replace(~r/<[^>]*>/, " ")
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 160)
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, _key, []), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp drop_nil_values(map), do: :maps.filter(fn _k, v -> not is_nil(v) end, map)

  defp val(map, keys, default) when is_map(map) do
    Enum.find_value(keys, default, fn key ->
      case Map.get(map, key) do
        nil -> false
        value -> value
      end
    end)
  end

  defp val(_map, _keys, default), do: default

  defp list_val(map, keys) do
    map
    |> val(keys, [])
    |> List.wrap()
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&to_string/1)
  end
end
