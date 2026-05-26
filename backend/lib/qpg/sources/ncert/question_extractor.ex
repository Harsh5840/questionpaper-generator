defmodule Qpg.Sources.Ncert.QuestionExtractor do
  @moduledoc """
  Extracts importable NCERT example and exercise questions from owned chapter text.

  This is intentionally deterministic. It only slices questions that are already
  present in the local NCERT corpus and stores them in `ncert_questions` so the UI
  can show per-section import rows such as `EXERCISE 12.1`.
  """

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.Repo

  @heading_regex ~r/^(\d+\.\d+)\s+(.{3,90})$/
  @exercise_regex ~r/^(EXERCISE\s+\d+(?:\.\d+)?)/i
  @example_regex ~r/^(EXAMPLE\s+(\d+))\s*:?\s*(.*)/i
  @question_regex ~r/^(\d{1,3})[.)]\s+(.+)/

  def retag_all(opts \\ []) do
    Logging.info("sources.ncert_questions.retag_all.started", %{opts: opts})

    documents = ncert_documents(opts)
    results = Enum.map(documents, &retag_document/1)

    summary = %{
      documents: length(documents),
      inserted: Enum.reduce(results, 0, &(&2 + &1.inserted)),
      skipped: Enum.reduce(results, 0, &(&2 + &1.skipped))
    }

    Logging.info("sources.ncert_questions.retag_all.completed", summary)
    summary
  end

  def retag_document(%{id: document_id} = document) do
    Logging.info("sources.ncert_questions.document.started", %{
      document_id: document_id,
      title: document.title
    })

    content = document_text(document_id)
    questions = extract_questions(content, document)
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.transaction(fn ->
      SQL.query!(Repo, "DELETE FROM ncert_questions WHERE source_document_id = $1", [
        Ecto.UUID.dump!(document_id)
      ])

      insert_question_rows(document_id, questions, document, now)
    end)

    Logging.info("sources.ncert_questions.document.completed", %{
      document_id: document_id,
      inserted: length(questions)
    })

    %{document_id: document_id, inserted: length(questions), skipped: 0}
  rescue
    error ->
      Logging.error("sources.ncert_questions.document.failed", %{
        document_id: document[:id],
        error: Exception.message(error)
      })

      %{document_id: document[:id], inserted: 0, skipped: 1}
  end

  def insert_questions(document_id, content, metadata, now) when is_binary(content) do
    questions = extract_questions(content, metadata)

    Logging.info("sources.ncert_questions.insert_questions.started", %{
      document_id: document_id,
      count: length(questions)
    })

    SQL.query!(Repo, "DELETE FROM ncert_questions WHERE source_document_id = $1", [
      Ecto.UUID.dump!(document_id)
    ])

    insert_question_rows(document_id, questions, metadata, now)
  end

  def extract_questions(content, metadata) do
    content
    |> normalize_text()
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> scan_lines(metadata)
    |> Enum.map(&clean_question/1)
    |> Enum.reject(&(String.length(&1.text) < 12))
    |> prefer_clean_duplicates()
    |> Enum.take(400)
  end

  defp ncert_documents(opts) do
    board = Keyword.get(opts, :board)
    class_level = Keyword.get(opts, :class_level)
    subject = Keyword.get(opts, :subject)
    chapter = Keyword.get(opts, :chapter)

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT id::text, title, board, class_level, subject, chapter, topic, chapter_id::text
        FROM source_documents
        WHERE lower(source_type) = 'ncert'
          AND lower(chapter) NOT IN ('prelims', 'appendix', 'answers part 1', 'answers part 2')
          AND ($1::text IS NULL OR lower(board) = lower($1))
          AND ($2::text IS NULL OR class_level = $2)
          AND ($3::text IS NULL OR lower(subject) = lower($3))
          AND ($4::text IS NULL OR lower(chapter) = lower($4))
        ORDER BY chapter, title
        """,
        [board, class_level, subject, chapter]
      )

    Enum.map(rows, fn [id, title, board, class_level, subject, chapter, topic, chapter_id] ->
      %{
        id: id,
        title: title,
        board: board,
        class_level: class_level,
        subject: subject,
        chapter: chapter,
        topic: topic,
        chapter_id: chapter_id
      }
    end)
  end

  defp document_text(document_id) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT content
        FROM source_chunks
        WHERE source_document_id = $1
        ORDER BY COALESCE((tags->>'chunk_index')::integer, 0), inserted_at
        """,
        [Ecto.UUID.dump!(document_id)]
      )

    rows
    |> Enum.map(fn [content] -> content end)
    |> Enum.join("\n\n")
  end

  defp normalize_text(content) do
    content
    |> to_string()
    |> String.replace(~r/\r\n?/, "\n")
    |> String.replace(~r/\f/, "\n")
    |> String.replace(~r/[ \t]+/, " ")
  end

  defp scan_lines(lines, metadata) do
    {questions, current, _section} =
      Enum.reduce(lines, {[], nil, default_section(metadata)}, fn line, {questions, current, section} ->
        cond do
          skip_line?(line) ->
            {questions, current, section}

          heading?(line) ->
            {flush_current(questions, current), nil, concept_section(line)}

          exercise = Regex.run(@exercise_regex, line) ->
            [_, label] = exercise
            next_section = %{label: clean_heading(label), type: "exercise"}
            {flush_current(questions, current), nil, next_section}

          example = Regex.run(@example_regex, line) ->
            [_, label, number, rest] = example
            next_section = %{label: clean_heading(label), type: "example"}
            next = new_question(String.to_integer(number), rest, next_section, metadata, "Example")
            {flush_current(questions, current), next, next_section}

          current != nil and current.section_type == "example" and Regex.match?(~r/^Solution\s*:/i, line) ->
            {flush_current(questions, current), nil, section}

          current != nil and current.section_type == "example" and Regex.match?(@question_regex, line) ->
            {flush_current(questions, current), nil, section}

          section.type == "exercise" and Regex.match?(@question_regex, line) ->
            match = Regex.run(@question_regex, line)
            [_, number, text] = match
            next = new_question(String.to_integer(number), text, section, metadata, "NCERT Exercise")
            {flush_current(questions, current), next, section}

          current != nil ->
            {questions, %{current | text: current.text <> "\n" <> line}, section}

          true ->
            {questions, current, section}
        end
      end)

    flush_current(questions, current)
    |> Enum.reverse()
  end

  defp default_section(metadata) do
    %{label: metadata[:chapter] || metadata["chapter"] || "NCERT", type: "chapter"}
  end

  defp heading?(line) do
    Regex.match?(@heading_regex, line) and not Regex.match?(~r/^\d+\.\d+\s*(cm|m|l|ml|kg|g)\b/i, line)
  end

  defp concept_section(line) do
    case Regex.run(@heading_regex, line) do
      [_, number, title] -> %{label: "#{number} #{clean_heading(title)}", type: "concept"}
      _ -> %{label: clean_heading(line), type: "concept"}
    end
  end

  defp new_question(number, text, section, metadata, question_type) do
    marks = infer_marks(text, question_type)

    %{
      question_number: number,
      text: text,
      section_label: section.label,
      section_type: section.type,
      question_type: question_type,
      marks: marks,
      difficulty: difficulty_from_marks(marks),
      board: metadata[:board] || metadata["board"],
      class_level: metadata[:class_level] || metadata["class_level"],
      subject: metadata[:subject] || metadata["subject"],
      chapter: metadata[:chapter] || metadata["chapter"],
      topic: metadata[:topic] || metadata["topic"] || metadata[:chapter] || metadata["chapter"],
      chapter_id: metadata[:chapter_id] || metadata["chapter_id"],
      answer: nil,
      tags: %{
        "source" => "internal_ncert_question_extractor",
        "section_type" => section.type
      }
    }
  end

  defp flush_current(questions, nil), do: questions
  defp flush_current(questions, current), do: [current | questions]

  defp clean_question(question) do
    text =
      question.text
      |> String.replace(~r/Reprint\s+\d{4}-\d{2}/i, "")
      |> String.replace(~r/^\d+\s+MATHEMATICS\s*$/im, "")
      |> String.replace(~r/^SURFACE AREAS AND VOLUMES\s+\d+\s*$/im, "")
      |> String.replace(~r/\n{3,}/, "\n\n")
      |> String.trim()

    %{question | text: text}
  end

  defp prefer_clean_duplicates(questions) do
    questions
    |> Enum.group_by(&{&1.section_label, &1.question_number})
    |> Enum.map(fn {_key, candidates} ->
      Enum.min_by(candidates, fn candidate ->
        String.length(candidate.text) + page_artifact_penalty(candidate.text)
      end)
    end)
    |> Enum.sort_by(&{section_sort_key(&1.section_label), &1.question_number || 0})
  end

  defp page_artifact_penalty(text) do
    text
    |> String.split("\n")
    |> Enum.count(&Regex.match?(~r/^\s*[A-Z][A-Z\s]{8,}\s+\d+\s*$/, &1))
    |> Kernel.*(500)
  end

  defp section_sort_key(section_label) do
    case Regex.run(~r/(\d+(?:\.\d+)?)/, to_string(section_label)) do
      [_, number] -> number |> String.split(".") |> Enum.map(&String.to_integer/1)
      _ -> [999]
    end
  end

  defp insert_question_rows(document_id, questions, metadata, now) when is_list(questions) do
    Enum.each(questions, fn question ->
      SQL.query!(
        Repo,
        """
        INSERT INTO ncert_questions
          (id, source_document_id, chapter_id, board, class_level, subject, chapter, topic,
           section_label, section_type, question_number, question_type, marks, difficulty,
           text, answer, tags, inserted_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
        """,
        [
          Ecto.UUID.dump!(Ecto.UUID.generate()),
          Ecto.UUID.dump!(document_id),
          dump_uuid_or_nil(question.chapter_id || metadata[:chapter_id] || metadata["chapter_id"]),
          question.board,
          question.class_level,
          question.subject,
          question.chapter,
          question.topic,
          question.section_label,
          question.section_type,
          question.question_number,
          question.question_type,
          question.marks,
          question.difficulty,
          question.text,
          question.answer,
          question.tags,
          now
        ]
      )
    end)
  end

  defp infer_marks(text, "Example"), do: min(5, max(1, div(String.length(text), 260) + 1))
  defp infer_marks(text, _type), do: min(5, max(1, div(String.length(text), 320) + 1))

  defp difficulty_from_marks(marks) when is_integer(marks) and marks <= 1, do: "Low"
  defp difficulty_from_marks(marks) when is_integer(marks) and marks <= 3, do: "Medium"
  defp difficulty_from_marks(_marks), do: "High"

  defp skip_line?(line) do
    line == "" or
      Regex.match?(~r/^Reprint\s+\d{4}-\d{2}$/i, line) or
      Regex.match?(~r/^P\.?T\.?O\.?$/i, line) or
      Regex.match?(~r/^MATHEMATICS\s*$/i, line)
  end

  defp clean_heading(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
  end

  defp dump_uuid_or_nil(value) when value in [nil, ""], do: nil
  defp dump_uuid_or_nil(value), do: Ecto.UUID.dump!(value)
end
