defmodule Qpg.Sources.Cbse.PyqTagger do
  @moduledoc """
  Builds normalized, tagged PYQ question rows from owned PYQ source documents.

  This stays deliberately internal and deterministic: it does not call an AI
  model and it does not invent question content. It only extracts visible
  questions from already-owned PYQ text/chunks and tags them with heuristic
  chapter/type/marks/difficulty metadata so retrieval can filter them.
  """

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.Repo

  @class_10_maths_chapter_rules [
    {"Real Numbers",
     [
       ~r/\bprime\b/i,
       ~r/\bhcf\b|\blcm\b/i,
       ~r/euclid/i,
       ~r/irrational|rational/i,
       ~r/fundamental theorem/i,
       ~r/factors? of .*number/i
     ]},
    {"Polynomials",
     [
       ~r/polynomial/i,
       ~r/zero(es)? of/i,
       ~r/graph of .*polynomial/i,
       ~r/\by\s*=\s*ax\^?2\s*\+/i,
       ~r/coefficients?/i
     ]},
    {"Pair Of Linear Equations In Two Variables",
     [
       ~r/pair of linear equations/i,
       ~r/linear equations?/i,
       ~r/system of equations?/i,
       ~r/intersecting lines|parallel lines|coincident lines/i,
       ~r/no solution|unique solution|infinitely many solutions/i
     ]},
    {"Quadratic Equations",
     [
       ~r/quadratic equation/i,
       ~r/discriminant/i,
       ~r/nature of roots/i,
       ~r/roots? of .*equation/i,
       ~r/factori[sz]ation/i,
       ~r/completing the square/i,
       ~r/square of .*age/i,
       ~r/original fraction/i,
       ~r/x\^?2.*x.*=|x².*x.*=/i
     ]},
    {"Arithmetic Progressions",
     [
       ~r/arithmetic progression/i,
       ~r/\bA\.?P\.?\b/i,
       ~r/common difference/i,
       ~r/nth term|n-th term/i,
       ~r/sum of .*terms/i,
       ~r/taken in order/i,
       ~r/divisible by .*in order/i
     ]},
    {"Triangles",
     [
       ~r/triangle/i,
       ~r/similar/i,
       ~r/pythagoras|pythagorean/i,
       ~r/corresponding sides/i,
       ~r/basic proportionality/i
     ]},
    {"Coordinate Geometry",
     [
       ~r/coordinate/i,
       ~r/distance formula/i,
       ~r/section formula/i,
       ~r/mid[- ]?point/i,
       ~r/centroid/i,
       ~r/\(\s*-?\d+\s*,\s*-?\d+\s*\)/
     ]},
    {"Introduction To Trigonometry",
     [
       ~r/trigonometric/i,
       ~r/\bsin\b|\bcos\b|\btan\b|\bcosec\b|\bsec\b|\bcot\b/i,
       ~r/\btheta\b|θ/i,
       ~r/identity/i
     ]},
    {"Some Applications Of Trigonometry",
     [
       ~r/height/i,
       ~r/distance/i,
       ~r/angle of elevation|angle of depression/i,
       ~r/\belevation\b|\bdepression\b/i,
       ~r/shadow|pole|kite/i,
       ~r/tower|building|observer/i
     ]},
    {"Circles",
     [
       ~r/circle/i,
       ~r/tangent/i,
       ~r/chord/i,
       ~r/secant/i,
       ~r/radius|diameter/i
     ]},
    {"Areas Related To Circles",
     [
       ~r/sector/i,
       ~r/segment/i,
       ~r/arc/i,
       ~r/area of .*circle/i,
       ~r/circumference/i
     ]},
    {"Surface Areas And Volumes",
     [
       ~r/surface area/i,
       ~r/volume/i,
       ~r/cylinder/i,
       ~r/cone/i,
       ~r/sphere|hemisphere/i,
       ~r/frustum/i
     ]},
    {"Statistics",
     [
       ~r/mean|median|mode/i,
       ~r/frequency/i,
       ~r/ogive/i,
       ~r/class interval/i,
       ~r/cumulative/i
     ]},
    {"Probability",
     [
       ~r/probability/i,
       ~r/dice|die|coin|card/i,
       ~r/random/i,
       ~r/event/i,
       ~r/favourable outcomes?/i
     ]}
  ]

  def retag_all(opts \\ []) do
    Logging.info("sources.pyq_tagger.retag_all.started", %{opts: opts})

    documents = pyq_documents(opts)

    results =
      Enum.map(documents, fn document ->
        retag_document(document)
      end)

    summary = %{
      documents: length(documents),
      inserted: Enum.reduce(results, 0, &(&2 + &1.inserted)),
      skipped: Enum.reduce(results, 0, &(&2 + &1.skipped))
    }

    Logging.info("sources.pyq_tagger.retag_all.completed", summary)
    summary
  end

  def retag_document(%{id: document_id} = document) do
    Logging.info("sources.pyq_tagger.document.started", %{
      document_id: document_id,
      title: document.title
    })

    content = document_text(document_id)
    questions = extract_questions(content, document)

    Repo.transaction(fn ->
      SQL.query!(Repo, "DELETE FROM pyq_questions WHERE source_document_id = $1", [
        Ecto.UUID.dump!(document_id)
      ])

      questions
      |> Enum.each(&insert_question(document_id, &1))
    end)

    result = %{document_id: document_id, inserted: length(questions), skipped: 0}

    Logging.info("sources.pyq_tagger.document.completed", %{
      document_id: document_id,
      inserted: result.inserted
    })

    result
  rescue
    error ->
      Logging.error("sources.pyq_tagger.document.failed", %{
        document_id: document[:id],
        error: Exception.message(error)
      })

      %{document_id: document[:id], inserted: 0, skipped: 1}
  end

  def extract_questions(content, metadata) do
    content
    |> normalize_text()
    |> scan_question_blocks(metadata)
    |> prefer_english_duplicates()
    |> Enum.map(&tag_question(&1, metadata))
    |> Enum.reject(&(String.length(String.trim(&1.text)) < 8))
  end

  def infer_chapter(text, metadata \\ %{}) do
    cond do
      Map.get(metadata, :chapter) not in [nil, ""] ->
        metadata.chapter

      Map.get(metadata, "chapter") not in [nil, ""] ->
        metadata["chapter"]

      true ->
        text = to_string(text)

        @class_10_maths_chapter_rules
        |> Enum.map(fn {chapter, regexes} ->
          score = Enum.count(regexes, &Regex.match?(&1, text))
          {chapter, score}
        end)
        |> Enum.max_by(fn {_chapter, score} -> score end, fn -> {nil, 0} end)
        |> case do
          {_chapter, 0} -> nil
          {chapter, _score} -> chapter
        end
    end
  end

  def difficulty_from_marks(marks) when is_integer(marks) and marks <= 1, do: "Low"
  def difficulty_from_marks(marks) when is_integer(marks) and marks <= 3, do: "Medium"
  def difficulty_from_marks(_marks), do: "High"

  def question_type_from_section(section, text, question_number \\ nil) do
    lower = String.downcase("#{section || ""} #{text}")

    cond do
      Regex.match?(~r/section a/i, to_string(section)) and question_number in 1..18 -> "MCQ"
      Regex.match?(~r/section a/i, to_string(section)) and question_number in 19..20 -> "Assertion-Reason"
      Regex.match?(~r/section b/i, to_string(section)) -> "VSA"
      Regex.match?(~r/section c/i, to_string(section)) -> "SA"
      Regex.match?(~r/section d/i, to_string(section)) -> "LA"
      Regex.match?(~r/section e/i, to_string(section)) -> "Case Study"
      String.contains?(lower, "mcq") or Regex.match?(~r/\([a-d]\)|\bA\./i, text) -> "MCQ"
      String.contains?(lower, "case") -> "Case Study"
      String.contains?(lower, "very short") -> "VSA"
      String.contains?(lower, "short") -> "SA"
      String.contains?(lower, "long") -> "LA"
      true -> "SA"
    end
  end

  def marks_from_section(section) do
    section = to_string(section || "")

    cond do
      section =~ ~r/SECTION A/i -> 1
      section =~ ~r/SECTION B/i -> 2
      section =~ ~r/SECTION C/i -> 3
      section =~ ~r/SECTION D/i -> 5
      section =~ ~r/SECTION E/i -> 4
      true -> 1
    end
  end

  def extract_marks(text) do
    case Regex.run(~r/\[?\(?\s*(\d+)\s*marks?\s*\)?\]?/i, text) do
      [_, marks] -> String.to_integer(marks)
      _ -> nil
    end
  end

  defp pyq_documents(opts) do
    board = Keyword.get(opts, :board)
    class_level = Keyword.get(opts, :class_level)
    subject = Keyword.get(opts, :subject)

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT id::text, title, board, class_level, subject, chapter, topic
        FROM source_documents
        WHERE lower(source_type) = 'pyq'
          AND ($1::text IS NULL OR lower(board) = lower($1))
          AND ($2::text IS NULL OR class_level = $2)
          AND ($3::text IS NULL OR lower(subject) = lower($3))
        ORDER BY title
        """,
        [board, class_level, subject]
      )

    Enum.map(rows, fn [id, title, board, class_level, subject, chapter, topic] ->
      %{
        id: id,
        title: title,
        board: board,
        class_level: class_level,
        subject: subject,
        chapter: chapter,
        topic: topic
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
    |> String.replace(~r/[ \t]+/, " ")
  end

  defp scan_question_blocks(content, metadata) do
    lines = String.split(content, "\n")

    {blocks, current, _section} =
      Enum.reduce(lines, {[], nil, nil}, fn line, {blocks, current, section} ->
        trimmed = String.trim(line)

        cond do
          trimmed == "" ->
            {blocks, current, section}

          Regex.match?(~r/^SECTION\s+[A-E]/i, trimmed) ->
            {flush_current(blocks, current), nil, String.upcase(trimmed)}

          match = Regex.run(~r/^(\d{1,3})[.)]\s+(.+)/, trimmed) ->
            [_, number, text] = match

            next = %{
              question_number: String.to_integer(number),
              text: text,
              section_label: section,
              paper_code: metadata.title,
              series: extract_series(content),
              year: extract_year(metadata.title)
            }

            {flush_current(blocks, current), next, section}

          current != nil and not Regex.match?(~r/^30\/S\/1|^P\.T\.O\.|^Page\b/i, trimmed) ->
            {blocks, %{current | text: current.text <> "\n" <> trimmed}, section}

          true ->
            {blocks, current, section}
        end
      end)

    blocks = flush_current(blocks, current)

    if Enum.any?(blocks, & &1.section_label) do
      Enum.filter(blocks, & &1.section_label)
    else
      blocks
    end
  end

  defp flush_current(blocks, nil), do: blocks
  defp flush_current(blocks, current), do: [current | blocks]

  defp prefer_english_duplicates(blocks) do
    blocks
    |> Enum.reverse()
    |> Enum.group_by(&{&1.section_label, &1.question_number})
    |> Enum.map(fn {_key, candidates} ->
      Enum.max_by(candidates, &english_score(&1.text))
    end)
    |> Enum.sort_by(&{section_order(&1.section_label), &1.question_number})
  end

  defp tag_question(block, metadata) do
    marks = extract_marks(block.text) || marks_from_section(block.section_label)
    chapter = infer_chapter(block.text, metadata)
    question_type = question_type_from_section(block.section_label, block.text, block.question_number)

    block
    |> Map.put(:text, String.trim(block.text))
    |> Map.put(:board, metadata.board)
    |> Map.put(:class_level, metadata.class_level)
    |> Map.put(:subject, metadata.subject)
    |> Map.put(:marks, marks)
    |> Map.put(:question_type, question_type)
    |> Map.put(:difficulty, difficulty_from_marks(marks))
    |> Map.put(:chapter, chapter)
    |> Map.put(:topic, chapter)
    |> Map.put(:tags, %{
      "tagging_status" => if(chapter, do: "heuristic_chapter_match", else: "untagged"),
      "difficulty" => difficulty_from_marks(marks),
      "question_type" => question_type,
      "source" => "internal_pyq_tagger"
    })
  end

  defp insert_question(document_id, question) do
    SQL.query!(
      Repo,
      """
      INSERT INTO pyq_questions
        (id, source_document_id, board, class_level, subject, chapter, topic, year,
         paper_code, series, section_label, question_number, question_type, marks,
         difficulty, text, tags, inserted_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())
      """,
      [
        Ecto.UUID.dump!(Ecto.UUID.generate()),
        Ecto.UUID.dump!(document_id),
        question.board,
        question.class_level,
        question.subject,
        question.chapter,
        question.topic,
        question.year,
        question.paper_code,
        question.series,
        question.section_label,
        question.question_number,
        question.question_type,
        question.marks,
        question.difficulty,
        question.text,
        question.tags
      ]
    )
  end

  defp english_score(text) do
    chars = String.graphemes(to_string(text))
    if chars == [], do: 0, else: Enum.count(chars, &Regex.match?(~r/[A-Za-z]/, &1)) / length(chars)
  end

  defp section_order(section) do
    case Regex.run(~r/SECTION\s+([A-E])/i, to_string(section)) do
      [_, letter] -> :binary.first(String.upcase(letter)) - ?A
      _ -> 99
    end
  end

  defp extract_series(content) do
    case Regex.run(~r/Series\s*:\s*([^\n]+)/i, content) do
      [_, series] -> String.trim(series)
      _ -> nil
    end
  end

  defp extract_year(title) do
    case Regex.run(~r/(20\d{2})/, to_string(title)) do
      [_, year] -> String.to_integer(year)
      _ -> nil
    end
  end
end
