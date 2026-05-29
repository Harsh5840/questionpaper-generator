defmodule Qpg.Sources.DumpCorpus do
  @moduledoc """
  Dump-native corpus access layer.

  The extracted textbook dump is now the preferred source of truth for pulling
  questions and context. This module intentionally returns the same coarse
  shapes as the older source context so existing controllers and the frontend
  can keep working while we expose richer dump metadata.
  """

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.QuestionBank
  alias Qpg.Repo

  def available? do
    case SQL.query(
           Repo,
           "SELECT to_regclass('public.ingested_textbooks') IS NOT NULL AND EXISTS (SELECT 1 FROM ingested_textbooks LIMIT 1)",
           []
         ) do
      {:ok, %Postgrex.Result{rows: [[true]]}} -> true
      _ -> false
    end
  rescue
    _ -> false
  end

  def list_chapters(filters) do
    params = chapter_filter_params(filters)

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT DISTINCT c.title, min(c.order_index), min(c.chapter_number)
        FROM ingested_chapters c
        JOIN ingested_textbooks t ON t.id = c.textbook_id
        WHERE ($1::text IS NULL OR t.grade = $1)
          AND (cardinality($2::text[]) = 0 OR lower(t.subject) = ANY($2::text[]))
          AND (
            cardinality($3::text[]) = 0
            OR t.id::text = ANY($3::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($3::text[]) AS book_filter(value)
              WHERE lower(t.title) LIKE '%' || book_filter.value || '%'
            )
          )
          AND c.title IS NOT NULL
          AND c.title <> ''
          AND NOT (
            lower(coalesce(t.book_type, '')) = 'pyq'
            OR lower(t.title) LIKE '%pyq%'
            OR lower(t.title) LIKE '%question bank%'
            OR lower(t.title) LIKE '%oswal%'
            OR lower(t.title) LIKE '%selina%'
            OR lower(t.publisher) = 'icse'
            OR lower(c.title) LIKE 'paper %'
          )
        GROUP BY c.title
        ORDER BY min(c.order_index) NULLS LAST, min(c.chapter_number) NULLS LAST, c.title ASC
        """,
        params
      )

    rows
    |> Enum.map(fn [title, _order, _chapter_number] -> title end)
    |> Enum.uniq_by(&(String.downcase(&1) |> String.replace(~r/[^a-z0-9]+/, "")))
  rescue
    error ->
      Logging.error("sources.dump.list_chapters.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      []
  end

  def catalog_context(filters) do
    params = chapter_filter_params(filters)

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          t.id::text,
          t.title,
          t.publisher,
          t.book_type,
          t.subject,
          t.grade,
          c.id::text,
          c.title,
          c.chapter_number,
          c.order_index,
          c.page_start,
          c.page_end,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', st.id::text,
                'name', st.name,
                'section_number', st.section_number,
                'page', st.page,
                'position', st.order_index
              )
            ) FILTER (WHERE st.id IS NOT NULL),
            '[]'::jsonb
          ) AS subtopics,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', bi.id::text,
                'label', bi.label,
                'title', bi.title,
                'page_start', bi.page_start,
                'page_end', bi.page_end,
                'position', bi.order_index
              )
            ) FILTER (WHERE bi.id IS NOT NULL),
            '[]'::jsonb
          ) AS book_index_entries
        FROM ingested_chapters c
        JOIN ingested_textbooks t ON t.id = c.textbook_id
        LEFT JOIN ingested_subtopics st ON st.chapter_id = c.id
        LEFT JOIN book_index_entries bi ON bi.textbook_id = t.id
          AND (bi.title ILIKE '%' || c.title || '%' OR c.title ILIKE '%' || bi.title || '%')
        WHERE ($1::text IS NULL OR t.grade = $1)
          AND (cardinality($2::text[]) = 0 OR lower(t.subject) = ANY($2::text[]))
          AND (
            cardinality($3::text[]) = 0
            OR t.id::text = ANY($3::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($3::text[]) AS book_filter(value)
              WHERE lower(t.title) LIKE '%' || book_filter.value || '%'
            )
          )
          AND (cardinality($4::text[]) = 0 OR lower(c.title) = ANY($4::text[]))
        GROUP BY t.id, c.id
        ORDER BY t.title, c.order_index NULLS LAST, c.chapter_number NULLS LAST, c.title
        """,
        params ++ [normalized_chapters_for_sql(filters)]
      )

    chapters =
      Enum.map(rows, fn [
                          book_id,
                          book_title,
                          publisher,
                          book_type,
                          subject,
                          grade,
                          chapter_id,
                          chapter_title,
                          chapter_number,
                          order_index,
                          page_start,
                          page_end,
                          subtopics,
                          book_index_entries
                        ] ->
        %{
          id: chapter_id,
          name: chapter_title,
          title: chapter_title,
          position: order_index || chapter_number,
          chapter_number: chapter_number,
          page_start: page_start,
          page_end: page_end,
          sections: normalize_json(subtopics),
          book_index_entries: normalize_json(book_index_entries),
          book: %{
            id: book_id,
            title: book_title,
            publisher: publisher,
            book_type: book_type,
            subject: subject,
            grade: grade
          },
          subject: %{name: subject},
          class: %{level: grade, name: "Class #{grade}"},
          board: %{code: "CBSE", name: "CBSE"}
        }
      end)

    %{
      board: %{code: "CBSE", name: "CBSE"},
      class: first_in(chapters, [:class]),
      subject: first_in(chapters, [:subject]),
      chapters: chapters,
      chapter_count: length(chapters),
      books:
        chapters
        |> Enum.map(& &1.book)
        |> Enum.uniq_by(& &1.id)
    }
  rescue
    error ->
      Logging.error("sources.dump.catalog_context.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      %{board: nil, class: nil, subject: nil, chapters: [], chapter_count: 0, books: []}
  end

  def search_chunks(source_group, filters, query, limit) do
    limit = normalize_limit(limit)
    like_query = "%#{query || ""}%"
    params = chunk_filter_params(filters, source_group) ++ [like_query, limit]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          ch.id::text,
          ch.section_label,
          ch.section_title,
          ch.page,
          left(ch.content, 1200),
          c.id::text,
          c.title,
          c.order_index,
          t.id::text,
          t.title,
          t.publisher,
          t.book_type,
          t.subject,
          t.grade
        FROM chapter_chunks ch
        JOIN ingested_chapters c ON c.id = ch.chapter_id
        JOIN ingested_textbooks t ON t.id = ch.textbook_id
        WHERE ($1::text IS NULL OR t.grade = $1)
          AND (cardinality($2::text[]) = 0 OR lower(t.subject) = ANY($2::text[]))
          AND (cardinality($3::text[]) = 0 OR lower(c.title) = ANY($3::text[]))
          AND (
            cardinality($4::text[]) = 0
            OR t.id::text = ANY($4::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($4::text[]) AS book_filter(value)
              WHERE lower(t.title) LIKE '%' || book_filter.value || '%'
            )
          )
          AND ($5::text = 'all' OR ($5::text = 'pyq') = (lower(coalesce(t.book_type, '')) = 'pyq' OR lower(t.title) LIKE '%pyq%' OR lower(t.title) LIKE '%question bank%' OR lower(t.title) LIKE '%oswal%'))
          AND ($6::text = '%%' OR ch.content ILIKE $6 OR ch.section_label ILIKE $6 OR ch.section_title ILIKE $6 OR c.title ILIKE $6)
        ORDER BY
          CASE WHEN ch.content ILIKE $6 THEN 0 ELSE 1 END,
          c.order_index NULLS LAST,
          ch.page NULLS LAST,
          ch.section_label NULLS LAST
        LIMIT $7
        """,
        params
      )

    Enum.map(rows, fn [
                        chunk_id,
                        section_label,
                        section_title,
                        page,
                        excerpt,
                        chapter_id,
                        chapter_title,
                        chapter_position,
                        book_id,
                        book_title,
                        publisher,
                        book_type,
                        subject,
                        grade
                      ] ->
      source_type =
        if pyq_source?(book_type, book_title, nil), do: "dump_pyq_chunk", else: "dump_chunk"

      %{
        id: chunk_id,
        chunk_id: chunk_id,
        source_type: source_type,
        title: [book_title, chapter_title, section_label || section_title] |> compact_join(" / "),
        excerpt: excerpt,
        content_excerpt: excerpt,
        citation:
          dump_citation(
            "CHUNK",
            book_title,
            chapter_title,
            section_label || section_title,
            chunk_id
          ),
        metadata: %{
          book_id: book_id,
          book_title: book_title,
          publisher: publisher,
          book_type: book_type,
          chapter_id: chapter_id,
          chapter: chapter_title,
          chapter_position: chapter_position,
          section_label: section_label,
          section_title: section_title,
          page: page,
          subject: subject,
          class_level: grade
        },
        signals: %{
          probable_question_type: nil,
          marks: nil,
          section_label: section_label,
          pyq_pattern: pyq_source?(book_type, book_title, nil)
        },
        skills: [],
        formulas: []
      }
    end)
  rescue
    error ->
      Logging.error("sources.dump.search_chunks.failed", %{
        source_group: source_group,
        filters: filters,
        error: Exception.message(error)
      })

      []
  end

  def search_questions(source_group, filters, limit) do
    limit = normalize_limit(limit)
    params = question_filter_params(filters, source_group) ++ [limit]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          q.id::text,
          q.text,
          q.question_type,
          q.difficulty,
          q.source_label,
          q.category,
          q.marks_possible,
          q.options,
          q.solution,
          q.order_index,
          c.id::text,
          c.title,
          c.order_index,
          t.id::text,
          t.title,
          t.publisher,
          t.book_type,
          t.subject,
          t.grade,
          bi.id::text,
          bi.label,
          bi.title,
          bi.page_start,
          bi.page_end,
          COALESCE(
            (
              SELECT jsonb_agg(DISTINCT s.skill_name)
              FROM ingested_question_skills iqs
              JOIN skills s ON s.id = iqs.skill_id
              WHERE iqs.question_id = q.id
            ),
            '[]'::jsonb
          ) AS skills,
          COALESCE(
            (
              SELECT jsonb_agg(DISTINCT COALESCE(f.display_name, f.name))
              FROM ingested_question_formulas iqf
              JOIN formulas f ON f.id = iqf.formula_id
              WHERE iqf.question_id = q.id
            ),
            '[]'::jsonb
          ) AS formulas
        FROM ingested_questions q
        JOIN ingested_chapters c ON c.id = q.chapter_id
        JOIN ingested_textbooks t ON t.id = c.textbook_id
        LEFT JOIN book_index_entries bi ON bi.id = q.book_index_entry_id
        WHERE ($1::text IS NULL OR t.grade = $1)
          AND (cardinality($2::text[]) = 0 OR lower(t.subject) = ANY($2::text[]))
          AND (cardinality($3::text[]) = 0 OR lower(c.title) = ANY($3::text[]))
          AND (
            cardinality($4::text[]) = 0
            OR t.id::text = ANY($4::text[])
            OR EXISTS (
              SELECT 1
              FROM unnest($4::text[]) AS book_filter(value)
              WHERE lower(t.title) LIKE '%' || book_filter.value || '%'
            )
          )
          AND (cardinality($5::text[]) = 0 OR lower(coalesce(q.category, '')) = ANY($5::text[]))
          AND ($6::text = 'all' OR ($6::text = 'pyq') = (lower(coalesce(q.category, '')) = 'pyq' OR lower(coalesce(t.book_type, '')) = 'pyq' OR lower(t.title) LIKE '%pyq%' OR lower(t.title) LIKE '%question bank%' OR lower(t.title) LIKE '%oswal%'))
        ORDER BY
          c.order_index NULLS LAST,
          q.order_index NULLS LAST,
          q.inserted_at ASC
        LIMIT $7
        """,
        params
      )

    Enum.map(rows, &question_row_to_result/1)
  rescue
    error ->
      Logging.error("sources.dump.search_questions.failed", %{
        source_group: source_group,
        filters: filters,
        error: Exception.message(error)
      })

      []
  end

  def retrieval_preview(filters) do
    query = retrieval_query(filters)
    ncert_questions = search_questions(:ncert, filters, 30)
    pyq_questions = search_questions(:pyq, filters, 20)
    ncert_chunks = search_chunks(:ncert, filters, query, max(0, 8 - length(ncert_questions)))
    pyq_chunks = search_chunks(:pyq, filters, query, max(0, 8 - length(pyq_questions)))
    question_bank = QuestionBank.result_blocks(filters, 8)
    marking_scheme = marking_scheme_context(filters)

    preview = %{
      catalog: catalog_context(filters),
      ncert: Enum.map(ncert_questions ++ ncert_chunks, &preview_result/1),
      pyq: Enum.map(pyq_questions ++ pyq_chunks, &preview_result/1),
      question_bank: Enum.map(question_bank, &preview_result/1),
      marking_scheme: marking_scheme,
      section_sources: section_sources(filters, ncert_questions, pyq_questions),
      warnings:
        retrieval_warnings(
          ncert_questions ++ ncert_chunks,
          pyq_questions ++ pyq_chunks,
          question_bank,
          marking_scheme
        )
    }

    Logging.info("sources.dump.retrieval_preview.completed", %{
      ncert_count: length(preview.ncert),
      pyq_count: length(preview.pyq),
      question_bank_count: length(preview.question_bank),
      warning_count: length(preview.warnings)
    })

    preview
  end

  def marking_scheme_context(filters) do
    pyq_questions = search_questions(:pyq, filters, 60)

    sections =
      pyq_questions
      |> Enum.group_by(fn result ->
        get_in(result, [:metadata, :source_label]) ||
          get_in(result, [:metadata, :section_label]) ||
          "PYQ Questions"
      end)
      |> Enum.map(fn {label, questions} ->
        marks = questions |> Enum.map(&(&1[:marks] || 1)) |> Enum.reject(&is_nil/1)
        count = length(questions)

        marks_each =
          if marks == [],
            do: nil,
            else:
              marks |> Enum.frequencies() |> Enum.max_by(fn {_mark, freq} -> freq end) |> elem(0)

        %{
          label: label,
          question_count: count,
          question_type:
            questions
            |> Enum.map(& &1[:question_type])
            |> Enum.reject(&is_nil/1)
            |> most_common("Mixed"),
          marks_each: marks_each,
          total_marks: Enum.sum(marks)
        }
      end)
      |> Enum.take(8)

    %{
      found: sections != [],
      sections: sections,
      source_titles:
        pyq_questions
        |> Enum.map(&get_in(&1, [:metadata, :book_title]))
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq(),
      warnings: if(sections == [], do: ["No dump PYQ marking-scheme context found."], else: [])
    }
  end

  def import_question(id) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          q.id::text,
          q.text,
          q.question_type,
          q.difficulty,
          q.source_label,
          q.category,
          q.marks_possible,
          q.options,
          q.solution,
          q.hints,
          q.body_store,
          q.or_alternative_of_id::text,
          q.order_index,
          c.id::text,
          c.title,
          t.id::text,
          t.title,
          t.publisher,
          t.book_type,
          t.subject,
          t.grade,
          bi.label,
          bi.title,
          COALESCE(
            (
              SELECT jsonb_agg(DISTINCT s.skill_name)
              FROM ingested_question_skills iqs
              JOIN skills s ON s.id = iqs.skill_id
              WHERE iqs.question_id = q.id
            ),
            '[]'::jsonb
          ) AS skills,
          COALESCE(
            (
              SELECT jsonb_agg(DISTINCT COALESCE(f.display_name, f.name))
              FROM ingested_question_formulas iqf
              JOIN formulas f ON f.id = iqf.formula_id
              WHERE iqf.question_id = q.id
            ),
            '[]'::jsonb
          ) AS formulas
        FROM ingested_questions q
        JOIN ingested_chapters c ON c.id = q.chapter_id
        JOIN ingested_textbooks t ON t.id = c.textbook_id
        LEFT JOIN book_index_entries bi ON bi.id = q.book_index_entry_id
        WHERE q.id = $1::uuid
        LIMIT 1
        """,
        [Ecto.UUID.dump!(id)]
      )

    case rows do
      [row] -> {:ok, imported_question(row)}
      _ -> {:error, :not_found}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  def import_chunk(id) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          ch.id::text,
          ch.content,
          ch.section_label,
          ch.section_title,
          ch.page,
          c.id::text,
          c.title,
          t.id::text,
          t.title,
          t.publisher,
          t.book_type,
          t.subject,
          t.grade
        FROM chapter_chunks ch
        JOIN ingested_chapters c ON c.id = ch.chapter_id
        JOIN ingested_textbooks t ON t.id = ch.textbook_id
        WHERE ch.id = $1::uuid
        LIMIT 1
        """,
        [Ecto.UUID.dump!(id)]
      )

    case rows do
      [
        [
          chunk_id,
          content,
          section_label,
          section_title,
          page,
          chapter_id,
          chapter_title,
          book_id,
          book_title,
          publisher,
          book_type,
          subject,
          grade
        ]
      ] ->
        generation_mode =
          if pyq_source?(book_type, book_title, nil), do: "direct_pyq", else: "direct_ncert"

        {:ok,
         %{
           "id" => Ecto.UUID.generate(),
           "text" => String.slice(to_string(content), 0, 1800),
           "richText" => "",
           "options" => [],
           "marks" => 1,
           "type" => "Source Extract",
           "difficulty" => "Medium",
           "source" => section_label || section_title || book_title,
           "topic" => chapter_title,
           "answer" => "",
           "answerRichText" => "",
           "tags" =>
             [publisher, book_type, section_label, section_title]
             |> Enum.reject(&(&1 in [nil, ""])),
           "generationMode" => generation_mode,
           "sourceCitations" => [
             dump_citation(
               "CHUNK",
               book_title,
               chapter_title,
               section_label || section_title,
               chunk_id
             )
           ],
           "sourceMetadata" => %{
             "dump_chunk_id" => chunk_id,
             "chapter_id" => chapter_id,
             "book_id" => book_id,
             "book_title" => book_title,
             "publisher" => publisher,
             "book_type" => book_type,
             "subject" => subject,
             "class_level" => grade,
             "page" => page,
             "section_label" => section_label,
             "section_title" => section_title
           }
         }}

      _ ->
        {:error, :not_found}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  def corpus_counts do
    %{
      textbooks: scalar("SELECT count(*) FROM ingested_textbooks"),
      chapters: scalar("SELECT count(*) FROM ingested_chapters"),
      chunks: scalar("SELECT count(*) FROM chapter_chunks"),
      questions: scalar("SELECT count(*) FROM ingested_questions"),
      pyq_questions:
        scalar("""
        SELECT count(*)
        FROM ingested_questions q
        JOIN ingested_chapters c ON c.id = q.chapter_id
        JOIN ingested_textbooks t ON t.id = c.textbook_id
        WHERE lower(coalesce(q.category, '')) = 'pyq'
          OR lower(coalesce(t.book_type, '')) = 'pyq'
          OR lower(t.title) LIKE '%pyq%'
          OR lower(t.title) LIKE '%question bank%'
        """),
      skills: scalar("SELECT count(*) FROM skills"),
      formulas: scalar("SELECT count(*) FROM formulas")
    }
  rescue
    _ ->
      %{
        textbooks: 0,
        chapters: 0,
        chunks: 0,
        questions: 0,
        pyq_questions: 0,
        skills: 0,
        formulas: 0
      }
  end

  def chapter_coverage(limit \\ 30) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          c.id::text,
          c.title,
          c.order_index,
          count(q.id) FILTER (WHERE lower(coalesce(q.category, '')) <> 'pyq')::int AS direct_count,
          count(q.id) FILTER (WHERE lower(coalesce(q.category, '')) = 'pyq' OR lower(coalesce(t.book_type, '')) = 'pyq')::int AS pyq_count,
          count(DISTINCT ch.id)::int AS chunk_count,
          count(DISTINCT s.id)::int AS skill_count,
          count(DISTINCT f.id)::int AS formula_count
        FROM ingested_chapters c
        JOIN ingested_textbooks t ON t.id = c.textbook_id
        LEFT JOIN ingested_questions q ON q.chapter_id = c.id
        LEFT JOIN chapter_chunks ch ON ch.chapter_id = c.id
        LEFT JOIN skills s ON lower(s.chapter) = lower(c.title) AND s.grade = t.grade
        LEFT JOIN ingested_formulas f ON f.chapter_id = c.id
        GROUP BY c.id
        ORDER BY count(q.id) DESC, c.order_index NULLS LAST, c.title
        LIMIT $1
        """,
        [limit]
      )

    Enum.map(rows, fn [
                        id,
                        name,
                        position,
                        direct_count,
                        pyq_count,
                        chunk_count,
                        skill_count,
                        formula_count
                      ] ->
      total = direct_count + pyq_count + chunk_count

      %{
        id: id,
        name: name,
        position: position,
        ncert_count: direct_count,
        pyq_count: pyq_count,
        bank_count: 0,
        chunk_count: chunk_count,
        skill_count: skill_count,
        formula_count: formula_count,
        total_sources: total,
        coverage_score:
          min(100, direct_count * 2 + pyq_count * 5 + chunk_count + skill_count + formula_count)
      }
    end)
  rescue
    _ -> []
  end

  def difficulty_distribution do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT COALESCE(NULLIF(difficulty, ''), 'Unknown'), count(*)::int
        FROM ingested_questions
        GROUP BY COALESCE(NULLIF(difficulty, ''), 'Unknown')
        ORDER BY 1
        """,
        []
      )

    Enum.map(rows, fn [difficulty, count] -> %{difficulty: difficulty, count: count} end)
  rescue
    _ -> []
  end

  def source_mix do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          COALESCE(NULLIF(t.book_type, ''), t.publisher, 'Unknown') AS source,
          count(q.id)::int
        FROM ingested_textbooks t
        LEFT JOIN ingested_chapters c ON c.textbook_id = t.id
        LEFT JOIN ingested_questions q ON q.chapter_id = c.id
        GROUP BY COALESCE(NULLIF(t.book_type, ''), t.publisher, 'Unknown')
        ORDER BY count(q.id) DESC
        """,
        []
      )

    Enum.map(rows, fn [source, count] -> %{source: source, count: count} end)
  rescue
    _ -> []
  end

  defp question_row_to_result([
         id,
         text,
         question_type,
         difficulty,
         source_label,
         category,
         marks,
         options,
         solution,
         order_index,
         chapter_id,
         chapter_title,
         chapter_position,
         book_id,
         book_title,
         publisher,
         book_type,
         subject,
         grade,
         book_index_id,
         book_index_label,
         book_index_title,
         page_start,
         page_end,
         skills,
         formulas
       ]) do
    is_pyq = pyq_source?(book_type, book_title, category)
    source_type = if is_pyq, do: "dump_pyq_question", else: "dump_question"

    %{
      id: id,
      source_type: source_type,
      title:
        [book_title, chapter_title, source_label || book_index_label || "Q#{order_index}"]
        |> compact_join(" / "),
      excerpt: text,
      content_excerpt: text,
      citation:
        dump_citation("QUESTION", book_title, chapter_title, source_label || book_index_label, id),
      metadata: %{
        book_id: book_id,
        book_title: book_title,
        publisher: publisher,
        book_type: book_type,
        chapter_id: chapter_id,
        chapter: chapter_title,
        chapter_position: chapter_position,
        source_label: source_label,
        category: category,
        order_index: order_index,
        question_id: id,
        book_index_id: book_index_id,
        book_index_label: book_index_label,
        book_index_title: book_index_title,
        page: page_start || page_end,
        page_start: page_start,
        page_end: page_end,
        subject: subject,
        class_level: grade,
        options: options || [],
        solution: solution
      },
      signals: %{
        probable_question_type: normalize_question_type(question_type, options),
        marks: marks,
        section_label: source_label || book_index_label,
        pyq_pattern: is_pyq
      },
      marks: marks,
      difficulty: difficulty,
      question_type: normalize_question_type(question_type, options),
      skills: normalize_json(skills),
      formulas: normalize_json(formulas)
    }
  end

  defp imported_question([
         id,
         text,
         question_type,
         difficulty,
         source_label,
         category,
         marks,
         options,
         solution,
         hints,
         body_store,
         or_alternative_of_id,
         order_index,
         chapter_id,
         chapter_title,
         book_id,
         book_title,
         publisher,
         book_type,
         subject,
         grade,
         book_index_label,
         book_index_title,
         skills,
         formulas
       ]) do
    generation_mode =
      if pyq_source?(book_type, book_title, category), do: "direct_pyq", else: "direct_ncert"

    %{
      "id" => Ecto.UUID.generate(),
      "text" => text,
      "richText" => "",
      "options" => option_blocks(options),
      "marks" => marks || 1,
      "type" => normalize_question_type(question_type, options),
      "difficulty" => difficulty || difficulty_from_marks(marks),
      "source" => source_label || book_title || "Dump corpus",
      "topic" => chapter_title,
      "answer" => solution || "",
      "answerRichText" => "",
      "tags" =>
        [
          category,
          publisher,
          book_type,
          book_index_label,
          book_index_title
        ]
        |> Enum.concat(normalize_json(skills))
        |> Enum.concat(normalize_json(formulas))
        |> Enum.concat(hints || [])
        |> Enum.reject(&(&1 in [nil, ""])),
      "generationMode" => generation_mode,
      "sourceCitations" => [
        dump_citation("QUESTION", book_title, chapter_title, source_label || book_index_label, id)
      ],
      "sourceMetadata" => %{
        "dump_question_id" => id,
        "chapter_id" => chapter_id,
        "book_id" => book_id,
        "book_title" => book_title,
        "publisher" => publisher,
        "book_type" => book_type,
        "subject" => subject,
        "class_level" => grade,
        "category" => category,
        "source_label" => source_label,
        "order_index" => order_index,
        "or_alternative_of_id" => or_alternative_of_id,
        "body_store" => body_store || %{}
      }
    }
  end

  defp option_blocks(options) when is_list(options) do
    options
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.with_index()
    |> Enum.map(fn {option, index} ->
      %{
        "id" => Ecto.UUID.generate(),
        "label" => <<65 + index::utf8>>,
        "text" => String.replace(to_string(option), ~r/^\(?[A-Da-d]\)?[.)]?\s*/, ""),
        "richText" => ""
      }
    end)
  end

  defp option_blocks(_), do: []

  defp section_sources(_filters, ncert_questions, pyq_questions) do
    grouped =
      (ncert_questions ++ pyq_questions)
      |> Enum.group_by(fn result ->
        metadata = result[:metadata] || %{}

        {metadata[:chapter] || "Source",
         metadata[:source_label] || metadata[:book_index_label] || metadata[:category] ||
           "Direct questions"}
      end)

    chapters =
      grouped
      |> Enum.group_by(fn {{chapter, _section}, _questions} -> chapter end)
      |> Enum.map(fn {chapter, entries} ->
        %{
          name: chapter,
          position:
            entries
            |> Enum.flat_map(fn {_key, questions} ->
              Enum.map(questions, &get_in(&1, [:metadata, :chapter_position]))
            end)
            |> Enum.reject(&is_nil/1)
            |> Enum.min(fn -> nil end),
          sections:
            Enum.map(entries, fn {{_chapter, section}, questions} ->
              %{
                name: section,
                section_type: source_section_type(section),
                ncert:
                  questions
                  |> Enum.reject(&get_in(&1, [:signals, :pyq_pattern]))
                  |> Enum.map(&preview_result/1),
                pyq:
                  questions
                  |> Enum.filter(&get_in(&1, [:signals, :pyq_pattern]))
                  |> Enum.map(&preview_result/1)
              }
            end)
        }
      end)

    %{chapters: chapters, ncert_count: length(ncert_questions), pyq_count: length(pyq_questions)}
  rescue
    _ -> %{chapters: [], ncert_count: length(ncert_questions), pyq_count: length(pyq_questions)}
  end

  defp preview_result(result) do
    metadata = result[:metadata] || result[:catalog] || %{}

    %{
      id: result[:id] || result[:chunk_id],
      source_type: result[:source_type],
      title: result[:title] || result[:citation],
      excerpt: result[:excerpt] || result[:content_excerpt] || result[:text],
      citation: result[:citation],
      metadata: metadata,
      signals: result[:signals] || %{},
      marks: result[:marks] || get_in(result, [:signals, :marks]),
      difficulty: result[:difficulty],
      question_type:
        result[:question_type] || get_in(result, [:signals, :probable_question_type]),
      book_id: metadata[:book_id],
      book_title: metadata[:book_title],
      publisher: metadata[:publisher],
      book_type: metadata[:book_type],
      chapter_id: metadata[:chapter_id],
      chapter: metadata[:chapter],
      section_label: metadata[:source_label] || metadata[:section_label],
      section_title: metadata[:section_title],
      page: metadata[:page],
      question_id: metadata[:question_id],
      category: metadata[:category],
      source_label: metadata[:source_label],
      order_index: metadata[:order_index],
      skills: result[:skills] || [],
      formulas: result[:formulas] || [],
      citations: [result[:citation]] |> Enum.reject(&is_nil/1)
    }
  end

  defp chunk_filter_params(filters, source_group) do
    [
      blank_to_nil(filters["class_level"] || filters["classLevel"]),
      subject_aliases(filters["subject_focus"] || filters["subject"]),
      normalized_chapters_for_sql(filters),
      normalized_source_books(filters),
      Atom.to_string(source_group)
    ]
  end

  defp question_filter_params(filters, source_group) do
    [
      blank_to_nil(filters["class_level"] || filters["classLevel"]),
      subject_aliases(filters["subject_focus"] || filters["subject"]),
      normalized_chapters_for_sql(filters),
      normalized_source_books(filters),
      normalized_source_categories(filters),
      Atom.to_string(source_group)
    ]
  end

  defp chapter_filter_params(filters) do
    [
      blank_to_nil(filters["class_level"] || filters["classLevel"]),
      subject_aliases(filters["subject_focus"] || filters["subject"]),
      normalized_source_books(filters)
    ]
  end

  defp normalized_chapters_for_sql(filters) do
    cond do
      filters["chapter_scope"] in ["full_syllabus", "fullSyllabus"] ->
        []

      is_list(filters["chapters"]) and filters["chapters"] != [] ->
        filters["chapters"]

      filters["chapter"] not in [nil, ""] ->
        [filters["chapter"]]

      true ->
        []
    end
    |> Enum.map(&(to_string(&1) |> String.downcase()))
    |> Enum.reject(&(&1 == ""))
  end

  defp normalized_source_books(filters) do
    (filters["source_books"] || filters["sourceBooks"] || [])
    |> List.wrap()
    |> Enum.map(&(to_string(&1) |> String.downcase()))
    |> Enum.reject(&(&1 == ""))
  end

  defp normalized_source_categories(filters) do
    (filters["source_categories"] || filters["sourceCategories"] || [])
    |> List.wrap()
    |> Enum.map(&(to_string(&1) |> String.downcase()))
    |> Enum.reject(&(&1 == ""))
  end

  defp subject_aliases(subject) do
    case subject |> to_string() |> String.downcase() do
      "" -> []
      "maths" -> ["math", "mathematics", "maths"]
      "mathematics" -> ["math", "mathematics", "maths"]
      "science" -> ["science", "physics", "chemistry", "biology"]
      "physics" -> ["physics"]
      "chemistry" -> ["chemistry"]
      "biology" -> ["biology"]
      other -> [other]
    end
  end

  defp retrieval_query(filters) do
    [
      filters["topic"],
      filters["chapter"],
      filters["chapters"],
      filters["subject"],
      filters["difficulty"]
    ]
    |> List.flatten()
    |> Enum.reject(&(&1 in [nil, "", []]))
    |> Enum.map(&to_string/1)
    |> Enum.join(" ")
  end

  defp retrieval_warnings(ncert, pyq, question_bank, marking_scheme) do
    []
    |> maybe_warn(
      ncert == [],
      "No dump direct textbook questions/chunks found for the selected filters."
    )
    |> maybe_warn(pyq == [], "No dump PYQ/question-bank examples found for the selected filters.")
    |> maybe_warn(question_bank == [], "No saved app question-bank items matched these filters.")
    |> maybe_warn(not marking_scheme[:found], "No dump PYQ marking-scheme context found.")
  end

  defp maybe_warn(warnings, true, warning), do: warnings ++ [warning]
  defp maybe_warn(warnings, false, _warning), do: warnings

  defp source_section_type(section_name) do
    cond do
      Regex.match?(~r/^exercise/i, to_string(section_name)) -> "exercise"
      Regex.match?(~r/^example/i, to_string(section_name)) -> "example"
      Regex.match?(~r/^section\s+[a-e]/i, to_string(section_name)) -> "pyq"
      true -> "source"
    end
  end

  defp pyq_source?(book_type, title, category) do
    text = [book_type, title, category] |> Enum.join(" ") |> String.downcase()

    String.contains?(text, "pyq") or String.contains?(text, "question bank") or
      String.contains?(text, "oswal")
  end

  defp normalize_question_type(type, options) do
    lower = String.downcase(to_string(type))

    cond do
      is_list(options) and options != [] -> "MCQ"
      String.contains?(lower, "mcq") or String.contains?(lower, "multiple") -> "MCQ"
      String.contains?(lower, "case") -> "Case Study"
      String.contains?(lower, "very") or String.contains?(lower, "vsa") -> "VSA"
      String.contains?(lower, "long") or String.contains?(lower, "la") -> "LA"
      String.contains?(lower, "short") or String.contains?(lower, "sa") -> "SA"
      lower == "" -> "SA"
      true -> String.trim(to_string(type))
    end
  end

  defp difficulty_from_marks(marks) when is_integer(marks) and marks <= 1, do: "Low"
  defp difficulty_from_marks(marks) when is_integer(marks) and marks <= 3, do: "Medium"
  defp difficulty_from_marks(_marks), do: "High"

  defp normalize_limit(limit) when is_integer(limit), do: limit |> max(1) |> min(60)

  defp normalize_limit(limit) when is_binary(limit) do
    case Integer.parse(limit) do
      {number, _} -> normalize_limit(number)
      :error -> 8
    end
  end

  defp normalize_limit(_limit), do: 8

  defp dump_citation(kind, book_title, chapter_title, label, id) do
    ["DUMP #{kind}", book_title, chapter_title, label, "id:#{id}"]
    |> compact_join(" / ")
  end

  defp compact_join(values, separator) do
    values
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.map(&to_string/1)
    |> Enum.join(separator)
  end

  defp normalize_json(value) when is_binary(value) do
    case Jason.decode(value) do
      {:ok, decoded} -> decoded
      _ -> value
    end
  end

  defp normalize_json(value), do: value || []

  defp most_common([], fallback), do: fallback

  defp most_common(values, fallback) do
    values
    |> Enum.reject(&(&1 in [nil, ""]))
    |> case do
      [] ->
        fallback

      filtered ->
        filtered
        |> Enum.frequencies()
        |> Enum.max_by(fn {_value, count} -> count end)
        |> elem(0)
    end
  end

  defp scalar(sql) do
    case SQL.query!(Repo, sql, []).rows do
      [[value]] -> value
      _ -> 0
    end
  end

  defp blank_to_nil(value) when value in [nil, ""], do: nil
  defp blank_to_nil(value), do: to_string(value)

  defp first_in([head | _], path), do: get_in(head, path)
  defp first_in([], _path), do: nil
end
