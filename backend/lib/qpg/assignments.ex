defmodule Qpg.Assignments do
  @moduledoc """
  Prod-aligned persistence for question papers (2 tables, one tree).

    * `assignments`           — one row per paper (identity + rules).
    * `assignment_questions`  — sections, questions and whole-question OR
                                alternatives are rows linked by `parent_id`.
                                A question's sub-parts live INLINE in its
                                `body_store.parts[]` (not as their own rows).

  Writes are reconciled in place by `source_question_key` so a question keeps the
  same row id across edits (student answers / marks point at it by id).

  Tenancy is per-schema: every read/write takes a `prefix:` (the school's schema);
  it defaults to `public` for standalone dev.
  """
  import Ecto.Query

  alias Qpg.Repo
  alias Qpg.Assignments.{Assignment, AssignmentQuestion}
  alias Qpg.Papers.Export

  @question_types ~w(section mcq assertion_reason short_answer extended_answer fill_blanks true_false matching other)

  # ── identity / tenancy defaults (dev fallbacks; the main app supplies real values) ──
  @dev_created_by "00000000-0000-0000-0000-000000000001"

  defp default_prefix, do: System.get_env("QPG_DEFAULT_PREFIX") || "public"
  defp default_created_by, do: System.get_env("QPG_DEV_CREATED_BY") || @dev_created_by
  defp resolve_prefix(opts), do: Keyword.get(opts, :prefix) || default_prefix()

  # ── Reads ──────────────────────────────────────────────────────────────────

  def list(opts \\ []) do
    Assignment
    |> order_by([a], desc: a.updated_at)
    |> Repo.all(prefix: resolve_prefix(opts))
  end

  def get_assignment(id, opts \\ []), do: Repo.get(Assignment, id, prefix: resolve_prefix(opts))

  def get_assignment!(id, opts \\ []), do: Repo.get!(Assignment, id, prefix: resolve_prefix(opts))

  def get_by_source_paper(paper_id, opts \\ []) do
    Repo.get_by(Assignment, [source_paper_id: paper_id], prefix: resolve_prefix(opts))
  end

  @doc """
  Load an assignment plus its rebuilt nested Paper JSON payload.
  Returns `nil` when the id is unknown.
  """
  def structured(id, opts \\ []) do
    case get_assignment(id, opts) do
      nil -> nil
      assignment -> %{assignment: assignment, payload: rebuild_payload(assignment, opts)}
    end
  end

  @doc "Rebuild the nested Paper JSON payload from the stored tree."
  def rebuild_payload(assignment_or_id, opts \\ [])

  def rebuild_payload(%Assignment{} = assignment, opts) do
    rows =
      AssignmentQuestion
      |> where([q], q.assignment_id == ^assignment.id)
      |> order_by([q], asc: q.sort_order)
      |> Repo.all(prefix: resolve_prefix(opts))

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

  def rebuild_payload(id, opts) when is_binary(id) do
    case get_assignment(id, opts) do
      nil -> nil
      assignment -> rebuild_payload(assignment, opts)
    end
  end

  defp rebuild_section(section, by_parent) do
    children = Map.get(by_parent, section.id, [])
    roots = children |> Enum.reject(& &1.is_or_alternative) |> Enum.sort_by(& &1.sort_order)
    or_alts = Enum.filter(children, & &1.is_or_alternative)

    %{
      "id" => section.source_question_key || section.id,
      "title" => section.section_label || body(section, "section_label") || "",
      "instructions" => body(section, "instructions") || "",
      "attemptRule" => body(section, "attempt_rule"),
      "questions" => Enum.map(roots, &rebuild_question(&1, or_alts))
    }
    |> drop_nil_values()
  end

  defp rebuild_question(q, section_or_alts) do
    # Whole-question OR alternative shares this question_number, sits under the section.
    choice =
      Enum.find(section_or_alts, fn alt ->
        alt.question_number == q.question_number and is_nil(alt.part_label)
      end)

    base_question_map(q)
    |> Map.put("options", rebuild_options(q))
    |> put_present("subparts", rebuild_parts(q))
    |> put_present("optionalChoice", choice && (base_question_map(choice) |> Map.put("options", rebuild_options(choice))))
  end

  # Sub-parts are stored inline in the parent's body_store.parts[].
  defp rebuild_parts(q) do
    q
    |> body("parts")
    |> List.wrap()
    |> Enum.map(fn part ->
      %{
        "id" => Map.get(part, "source_question_key"),
        "label" => Map.get(part, "part_label"),
        "text" => Map.get(part, "question_text") || "",
        "richText" => "",
        "type" => Map.get(part, "question_type") || "",
        "marks" => Map.get(part, "marks_possible") || 0,
        "answer" => Map.get(part, "expected_answer") || "",
        "options" => rebuild_option_list(Map.get(part, "options")),
        "optionalChoice" => rebuild_part_choice(Map.get(part, "optional_choice"))
      }
      |> drop_nil_values()
    end)
  end

  defp rebuild_part_choice(choice) when is_map(choice) do
    %{
      "id" => Map.get(choice, "source_question_key"),
      "text" => Map.get(choice, "question_text") || "",
      "type" => Map.get(choice, "question_type") || "",
      "marks" => Map.get(choice, "marks_possible") || 0,
      "answer" => Map.get(choice, "expected_answer") || "",
      "options" => rebuild_option_list(Map.get(choice, "options"))
    }
  end

  defp rebuild_part_choice(_), do: nil

  defp base_question_map(q) do
    %{
      "id" => q.source_question_key || q.id,
      "text" => body(q, "question_text") || "",
      "richText" => "",
      "marks" => q.marks_possible || 0,
      "type" => body(q, "ui_type") || q.question_type || "",
      "difficulty" => q.difficulty || "",
      "source" => q.source_type || "",
      "topic" => body(q, "topic"),
      "answer" => body(q, "expected_answer") || "",
      "answerRichText" => "",
      "sourceCitations" => body(q, "citations") || [],
      "tags" => body(q, "tags") || []
    }
  end

  defp rebuild_options(q), do: rebuild_option_list(body(q, "options"))

  defp rebuild_option_list(options) do
    options
    |> List.wrap()
    |> Enum.map(fn opt ->
      %{
        "id" => Map.get(opt, "id"),
        "label" => Map.get(opt, "label") || Map.get(opt, "id"),
        "text" => Map.get(opt, "text") || "",
        "richText" => "",
        "isCorrect" => Map.get(opt, "is_correct") || false
      }
    end)
  end

  # ── Writes ───────────────────────────────────────────────────────────────────

  @doc """
  Create (or update) an assignment for a legacy paper, keyed by `:source_paper_id`.
  Used by the one-time backfill.
  """
  def upsert_from_payload(payload, opts \\ []) when is_map(payload) do
    prefix = resolve_prefix(opts)
    source_paper_id = Keyword.get(opts, :source_paper_id)
    attrs = build_attrs(payload, opts)

    Repo.transaction(fn ->
      case source_paper_id && get_by_source_paper(source_paper_id, opts) do
        nil -> %Assignment{}
        existing -> existing
      end
      |> Assignment.changeset(attrs)
      |> Repo.insert_or_update!(prefix: prefix)
      |> sync_tree!(payload, prefix)
    end)
  end

  @doc "Create a brand-new assignment + tree from a nested Paper JSON payload."
  def create_from_payload(payload, opts \\ []) when is_map(payload) do
    prefix = resolve_prefix(opts)
    attrs = build_attrs(payload, opts)

    Repo.transaction(fn ->
      %Assignment{}
      |> Assignment.changeset(attrs)
      |> Repo.insert!(prefix: prefix)
      |> sync_tree!(payload, prefix)
    end)
  end

  @doc "Create an assignment from one generated paper variant."
  def create_from_variant(variant, request, source, opts \\ []) when is_map(variant) do
    create_from_payload(
      variant,
      Keyword.merge(
        [
          title: Map.get(variant, "title"),
          board_code: request["board"],
          class_level: request["class_level"],
          subject: request["subject"],
          class_id: request["class_id"],
          subject_id: request["subject_id"],
          created_by: request["created_by"],
          input_mode: source,
          status: "draft",
          prefix: request["prefix"]
        ],
        opts
      )
    )
  end

  @doc """
  Persist an edited payload onto an existing assignment, reconciling its tree in
  place (rows matched by `source_question_key` keep their ids).
  """
  def save_payload(%Assignment{} = assignment, payload, _change_source, opts \\ []) when is_map(payload) do
    prefix = resolve_prefix(opts)
    metadata = Map.get(payload, "metadata", %{})

    board = val(metadata, ["board"], nil) || assignment.board_code
    level = val(metadata, ["classLevel", "class_level"], nil) || assignment.class_level
    subject = val(metadata, ["subject"], nil) || assignment.subject
    class_id = lookup_class_id(board, level) || assignment.class_id
    subject_id = lookup_subject_id(class_id, subject) || assignment.subject_id

    attrs = %{
      title: Map.get(payload, "title") || assignment.title,
      board_code: board,
      class_level: level,
      subject: subject,
      class_id: class_id,
      subject_id: subject_id,
      instructions: Map.get(payload, "instructions") || assignment.instructions,
      total_marks: total_marks(payload)
    }

    Repo.transaction(fn ->
      assignment
      |> Assignment.changeset(attrs)
      |> Repo.update!(prefix: prefix)
      |> sync_tree!(payload, prefix)
    end)
  end

  def delete_assignment(%Assignment{} = assignment, opts \\ []) do
    Repo.delete(assignment, prefix: resolve_prefix(opts))
  end

  @doc "Queue an export row for an assignment (PDF/DOCX)."
  def create_export(%Assignment{} = assignment, attrs, opts \\ []) do
    %Export{}
    |> Export.changeset(%{
      paper_id: assignment.id,
      format: attrs["format"] || "pdf",
      status: "queued"
    })
    |> Repo.insert(prefix: resolve_prefix(opts))
  end

  defp build_attrs(payload, opts) do
    metadata = Map.get(payload, "metadata", %{})
    board = Keyword.get(opts, :board_code) || val(metadata, ["board"], nil)
    level = Keyword.get(opts, :class_level) || val(metadata, ["classLevel", "class_level"], nil)
    subject = Keyword.get(opts, :subject) || val(metadata, ["subject"], nil)
    class_id = Keyword.get(opts, :class_id) || lookup_class_id(board, level)
    subject_id = Keyword.get(opts, :subject_id) || lookup_subject_id(class_id, subject)

    %{
      created_by: Keyword.get(opts, :created_by) || default_created_by(),
      title: Keyword.get(opts, :title) || Map.get(payload, "title") || "Question Paper",
      board_code: board,
      class_level: level,
      subject: subject,
      class_id: class_id,
      subject_id: subject_id,
      instructions: Map.get(payload, "instructions"),
      input_mode: norm_input_mode(Keyword.get(opts, :input_mode)),
      status: Keyword.get(opts, :status, "draft"),
      total_marks: total_marks(payload),
      source_paper_id: Keyword.get(opts, :source_paper_id)
    }
  end

  # ── tree reconcile (update-in-place by source_question_key) ───────────────────

  defp sync_tree!(%Assignment{} = assignment, payload, prefix) do
    existing =
      AssignmentQuestion
      |> where([q], q.assignment_id == ^assignment.id)
      |> Repo.all(prefix: prefix)

    # key -> [rows]; we pop one row per desired key so duplicate keys (legacy data)
    # are matched one-to-one instead of collapsing onto a single row.
    remaining = Enum.group_by(existing, & &1.source_question_key)
    {section_specs, question_specs} = desired_specs(payload)

    {section_id_map, remaining} =
      Enum.reduce(section_specs, {%{}, remaining}, fn spec, {map, rem} ->
        {match, rem} = pop_match(rem, spec.key)
        row = upsert_row!(assignment, match, spec, nil, prefix)
        {Map.put(map, spec.key, row.id), rem}
      end)

    remaining =
      Enum.reduce(question_specs, remaining, fn spec, rem ->
        {match, rem} = pop_match(rem, spec.key)
        parent_id = Map.get(section_id_map, spec.section_key)
        upsert_row!(assignment, match, spec, parent_id, prefix)
        rem
      end)

    # Anything left unmatched was removed from the paper.
    remaining
    |> Map.values()
    |> List.flatten()
    |> Enum.each(&Repo.delete!(&1, prefix: prefix))

    assignment
  end

  defp pop_match(remaining, key) do
    case Map.get(remaining, key, []) do
      [row | rest] -> {row, Map.put(remaining, key, rest)}
      [] -> {nil, remaining}
    end
  end

  defp upsert_row!(%Assignment{} = assignment, existing, spec, parent_id, prefix) do
    attrs = %{
      assignment_id: assignment.id,
      parent_id: parent_id,
      question_type: spec.type,
      question_number: spec.qnum,
      section_label: spec.section_label,
      part_label: spec.part_label,
      marks_possible: spec.marks,
      sort_order: spec.sort,
      source_question_key: spec.key,
      is_or_alternative: spec.is_or,
      difficulty: spec.difficulty,
      short_prompt: spec.short_prompt,
      source_type: spec.source_type,
      content_question_id: spec.content_question_id,
      body_store: spec.body
    }

    case existing do
      nil ->
        %AssignmentQuestion{}
        |> AssignmentQuestion.changeset(attrs)
        |> Repo.insert!(prefix: prefix)

      row ->
        row
        |> AssignmentQuestion.changeset(attrs)
        |> Repo.update!(prefix: prefix)
    end
  end

  # Flatten the payload into ordered row specs. Sub-parts are NOT rows — they ride
  # inside each question's body_store.parts[]. Only sections, questions and
  # whole-question OR-alternatives become rows.
  defp desired_specs(payload) do
    sections = payload |> Map.get("sections", []) |> List.wrap()

    acc =
      sections
      |> Enum.with_index()
      |> Enum.reduce(%{sort: 0, qnum: 0, sections: [], questions: [], used: MapSet.new()}, fn {section, si}, acc ->
        {section_key, acc} = uniq_key(val(section, ["id", "key"], "section_#{si}"), acc)
        section_label = val(section, ["title", "label"], nil)

        section_spec = %{
          key: section_key,
          type: "section",
          section_key: nil,
          qnum: nil,
          part_label: nil,
          is_or: false,
          marks: nil,
          difficulty: nil,
          short_prompt: val(section, ["title"], "Section"),
          source_type: nil,
          content_question_id: nil,
          section_label: section_label,
          sort: acc.sort,
          body: section_body(section)
        }

        acc = %{acc | sort: acc.sort + 1, sections: [section_spec | acc.sections]}

        section
        |> val(["questions"], [])
        |> List.wrap()
        |> Enum.reduce(acc, fn q, acc ->
          qnum = acc.qnum + 1
          {qkey, acc} = uniq_key(val(q, ["id", "key"], "q_#{qnum}"), acc)

          q_spec = %{
            key: qkey,
            type: map_type(q),
            section_key: section_key,
            qnum: qnum,
            part_label: nil,
            is_or: false,
            marks: float_marks(q),
            difficulty: norm_difficulty(q),
            short_prompt: preview(q),
            source_type: source_type(q),
            content_question_id: content_qid(q),
            section_label: section_label,
            sort: acc.sort,
            body: content_body(q, section_label, qkey, false)
          }

          acc = %{acc | sort: acc.sort + 1, qnum: qnum, questions: [q_spec | acc.questions]}

          case val(q, ["optionalChoice", "optional_choice"], nil) do
            choice when is_map(choice) ->
              {ckey, acc} = uniq_key(or_key(qkey), acc)

              c_spec = %{
                key: ckey,
                type: map_type(choice),
                section_key: section_key,
                qnum: qnum,
                part_label: nil,
                is_or: true,
                marks: float_marks(choice),
                difficulty: norm_difficulty(choice),
                short_prompt: preview(choice),
                source_type: source_type(choice),
                content_question_id: content_qid(choice),
                section_label: section_label,
                sort: acc.sort,
                body: content_body(choice, section_label, ckey, true)
              }

              %{acc | sort: acc.sort + 1, questions: [c_spec | acc.questions]}

            _ ->
              acc
          end
        end)
      end)

    {Enum.reverse(acc.sections), Enum.reverse(acc.questions)}
  end

  # Ensure source_question_key is unique within an assignment (AI papers reuse
  # "q1" across sections). Reconcile matches rows by this key, so collisions would
  # leave duplicate rows un-updated.
  defp uniq_key(key, acc) do
    key = to_string(key)
    used = acc.used

    unique =
      if MapSet.member?(used, key) do
        Stream.iterate(2, &(&1 + 1))
        |> Enum.find_value(fn n ->
          candidate = "#{key}__#{n}"
          if MapSet.member?(used, candidate), do: nil, else: candidate
        end)
      else
        key
      end

    {unique, %{acc | used: MapSet.put(used, unique)}}
  end

  defp section_body(section) do
    %{
      "section_label" => val(section, ["title", "label"], nil),
      "instructions" => val(section, ["instructions"], nil),
      "attempt_rule" => val(section, ["attemptRule", "attempt_rule"], nil)
    }
  end

  # ── body_store content shape (exact key names the main app reads) ─────────────

  defp content_body(q, section_label, key, is_or?) do
    %{
      "source_question_key" => key,
      "question_text" => val(q, ["text"], ""),
      "question_type" => map_type(q),
      "expected_answer" => val(q, ["answer"], ""),
      "options" => content_options(q),
      "options_status" => options_status(q),
      "fib_answers" => fib_answers(q),
      "parts" => content_parts(q, section_label),
      # extras the main app ignores — kept for our own rebuild / browsing.
      "ui_type" => val(q, ["type", "question_type"], nil),
      "section" => section_label,
      "points_possible" => float_marks(q),
      "is_or_alternative" => is_or?,
      "visual_regions" => [],
      "topic" => val(q, ["topic"], nil),
      "citations" => list_val(q, ["sourceCitations", "source_citations"]),
      "tags" => list_val(q, ["tags"])
    }
  end

  # Sub-parts, nested inline (option A / TODO #5).
  defp content_parts(q, _section_label) do
    q
    |> val(["subparts", "sub_parts"], [])
    |> List.wrap()
    |> Enum.with_index(1)
    |> Enum.map(fn {sp, idx} ->
      part_label = val(sp, ["label"], Integer.to_string(idx))
      part_key = val(sp, ["id", "key"], "part_#{idx}")

      %{
        "source_question_key" => part_key,
        "part_label" => part_label,
        "question_text" => val(sp, ["text"], ""),
        "question_type" => map_type(sp),
        "expected_answer" => val(sp, ["answer"], ""),
        "options" => content_options(sp),
        "options_status" => options_status(sp),
        "fib_answers" => fib_answers(sp),
        "marks_possible" => float_marks(sp),
        "content_question_id" => content_qid(sp),
        "optional_choice" => part_choice_body(sp)
      }
    end)
  end

  defp part_choice_body(sp) do
    case val(sp, ["optionalChoice", "optional_choice"], nil) do
      choice when is_map(choice) ->
        %{
          "source_question_key" => or_key(val(sp, ["id", "key"], "part")),
          "question_text" => val(choice, ["text"], ""),
          "question_type" => map_type(choice),
          "expected_answer" => val(choice, ["answer"], ""),
          "options" => content_options(choice),
          "options_status" => options_status(choice),
          "fib_answers" => fib_answers(choice),
          "marks_possible" => float_marks(choice)
        }

      _ ->
        nil
    end
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
        "is_correct" => Map.get(opt, "isCorrect") || Map.get(opt, "is_correct") || false,
        "has_visual" => Map.get(opt, "hasVisual") || Map.get(opt, "has_visual") || false
      }
    end)
  end

  # complete = options present and one marked correct; missing_answer = options but
  # no correct flag; none = no options (free-response).
  defp options_status(q) do
    opts = content_options(q)

    cond do
      opts == [] -> "none"
      Enum.any?(opts, & &1["is_correct"]) -> "complete"
      true -> "missing_answer"
    end
  end

  # For fill_blanks, the per-blank answers (split the expected answer); else [].
  defp fib_answers(q) do
    if map_type(q) == "fill_blanks" do
      q
      |> val(["answer"], "")
      |> to_string()
      |> String.split(~r/[\n;,]/)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))
    else
      []
    end
  end

  # ── lookups (board/class/subject ids; catalog lives in the public schema) ─────

  defp lookup_class_id(board, level) when is_binary(board) and is_binary(level) do
    scalar_id(
      "SELECT c.id::text FROM school_classes c JOIN boards b ON b.id = c.board_id WHERE lower(b.code) = lower($1) AND c.level = $2 LIMIT 1",
      [board, level]
    )
  end

  defp lookup_class_id(_, _), do: nil

  defp lookup_subject_id(class_id, name) when is_binary(class_id) and is_binary(name) do
    case Ecto.UUID.dump(class_id) do
      {:ok, bin} ->
        scalar_id(
          "SELECT s.id::text FROM subjects s WHERE s.school_class_id = $1 AND lower(s.name) = lower($2) LIMIT 1",
          [bin, name]
        )

      :error ->
        nil
    end
  end

  defp lookup_subject_id(_, _), do: nil

  defp scalar_id(sql, params) do
    case Repo.query(sql, params) do
      {:ok, %{rows: [[id]]}} when is_binary(id) -> id
      _ -> nil
    end
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
    raw = val(q, ["type", "question_type"], "") |> to_string() |> String.downcase() |> String.trim()

    case raw do
      "" -> "short_answer"
      "mcq" -> "mcq"
      "multiple choice" -> "mcq"
      "short answer" -> "short_answer"
      "very short answer" -> "short_answer"
      "long answer" -> "extended_answer"
      "extended answer" -> "extended_answer"
      "case study" -> "other"
      "case_study" -> "other"
      "assertion reason" -> "assertion_reason"
      "fill in the blanks" -> "fill_blanks"
      "fill_blank" -> "fill_blanks"
      "true/false" -> "true_false"
      "true false" -> "true_false"
      other -> clamp_type(other)
    end
  end

  defp clamp_type(value) do
    norm = value |> String.replace(~r/[^a-z0-9]+/, "_") |> String.trim("_")
    if norm in @question_types, do: norm, else: "other"
  end

  # Maps generationMode → prod-aligned source_type enum: ncert | pyq | question_bank | ai.
  # generationMode values: "direct_ncert", "direct_pyq", "question_bank", "ai_generated".
  defp source_type(q) do
    mode = val(q, ["generationMode", "generation_mode"], "") |> to_string() |> String.downcase()
    src = val(q, ["source"], "") |> to_string() |> String.downcase()

    cond do
      String.contains?(mode, "pyq") or String.contains?(src, "pyq") -> "pyq"
      mode == "question_bank" -> "question_bank"
      String.contains?(mode, "ncert") or String.contains?(mode, "dump") or String.contains?(src, "ncert") -> "ncert"
      content_qid(q) != nil -> "ncert"
      true -> "ai"
    end
  end

  defp content_qid(q) do
    case val(q, ["contentQuestionId", "content_question_id"], nil) do
      nil -> nil
      v -> case Ecto.UUID.cast(to_string(v)) do
             {:ok, uuid} -> uuid
             :error -> nil
           end
    end
  end

  # input_mode (on the assignment): "ncert" (generated from corpus) or "manual".
  defp norm_input_mode(mode) do
    case mode |> to_string() |> String.downcase() do
      "" -> "manual"
      "manual" -> "manual"
      "image" -> "manual"
      "blank" -> "manual"
      _ -> "ncert"
    end
  end

  defp float_marks(q) do
    case val(q, ["marks"], nil) do
      n when is_number(n) ->
        n / 1

      s when is_binary(s) ->
        case Float.parse(s) do
          {f, _} -> f
          :error -> nil
        end

      _ ->
        nil
    end
  end

  defp norm_difficulty(q) do
    case val(q, ["difficulty"], nil) do
      nil -> nil
      d -> d |> to_string() |> String.downcase()
    end
  end

  defp or_key(nil), do: nil
  defp or_key(key), do: if(String.ends_with?(key, "_or"), do: key, else: key <> "_or")

  defp preview(q) do
    q
    |> val(["text"], "")
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
