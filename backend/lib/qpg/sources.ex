defmodule Qpg.Sources do
  @moduledoc """
  Context for owned learning-source material such as NCERT chapters and PYQs.
  """

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.QuestionBank
  alias Qpg.QuestionBank.QuestionBankItem
  alias Qpg.Repo
  alias Qpg.Sources.Ncert.Import

  def ingest_ncert_path(path) do
    Logging.info("sources.ncert.ingest_path.delegated", %{path: path})
    Import.ingest_path(path)
  end

  def list_chapters(filters) do
    Logging.info("sources.catalog.list_chapters.started", %{filters: filters})

    case list_catalog_chapters(filters) do
      [] ->
        Logging.warning("sources.catalog.list_chapters.catalog_empty_using_source_documents", %{
          filters: filters
        })

        list_source_document_chapters(filters)

      chapters ->
        Logging.info("sources.catalog.list_chapters.completed", %{
          count: length(chapters),
          chapters: chapters
        })

        chapters
    end
  end

  def catalog_context(filters) do
    Logging.debug("sources.catalog_context.started", %{filters: filters})

    params = [
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"]),
      context_chapters(filters)
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          b.id::text,
          b.code,
          b.name,
          sc.id::text,
          sc.level,
          sc.name,
          s.id::text,
          s.name,
          c.id::text,
          c.name,
          c.position,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'id', cs.id::text,
                'name', cs.name,
                'section_type', cs.section_type,
                'position', cs.position,
                'metadata', cs.metadata
              )
              ORDER BY cs.position NULLS LAST, cs.name
            ) FILTER (WHERE cs.id IS NOT NULL),
            '[]'::jsonb
          ) AS sections
        FROM boards b
        JOIN school_classes sc ON sc.board_id = b.id
        JOIN subjects s ON s.school_class_id = sc.id
        JOIN chapters c ON c.subject_id = s.id
        LEFT JOIN chapter_sections cs ON cs.chapter_id = c.id
        WHERE ($1::text IS NULL OR lower(b.code) = lower($1) OR lower(b.name) = lower($1))
          AND ($2::text IS NULL OR sc.level = $2)
          AND ($3::text IS NULL OR lower(s.name) = lower($3))
          AND (cardinality($4::text[]) = 0 OR lower(c.name) = ANY(SELECT lower(unnest($4::text[]))))
        GROUP BY b.id, b.code, b.name, sc.id, sc.level, sc.name, s.id, s.name, c.id, c.name, c.position
        ORDER BY c.position NULLS LAST, c.name ASC
        """,
        params
      )

    chapters =
      Enum.map(rows, fn [
                          board_id,
                          board_code,
                          board_name,
                          class_id,
                          class_level,
                          class_name,
                          subject_id,
                          subject_name,
                          chapter_id,
                          chapter_name,
                          chapter_position,
                          sections
                        ] ->
        %{
          id: chapter_id,
          name: chapter_name,
          position: chapter_position,
          sections: normalize_json_value(sections),
          subject: %{id: subject_id, name: subject_name},
          class: %{id: class_id, level: class_level, name: class_name},
          board: %{id: board_id, code: board_code, name: board_name}
        }
      end)

    context = %{
      board: first_in(chapters, [:board]),
      class: first_in(chapters, [:class]),
      subject: first_in(chapters, [:subject]),
      chapters: chapters,
      chapter_count: length(chapters)
    }

    Logging.debug("sources.catalog_context.completed", %{
      filters: filters,
      chapter_count: context.chapter_count
    })

    context
  rescue
    error ->
      Logging.error("sources.catalog_context.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      %{board: nil, class: nil, subject: nil, chapters: [], chapter_count: 0}
  end

  def ensure_catalog_entry(%{
        board: board,
        class_level: class_level,
        subject: subject,
        chapter: chapter
      })
      when board not in [nil, ""] and class_level not in [nil, ""] and subject not in [nil, ""] do
    Logging.debug("sources.catalog.ensure_entry.started", %{
      board: board,
      class_level: class_level,
      subject: subject,
      chapter: chapter
    })

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        WITH input AS (
          SELECT
            $1::text AS board,
            $2::text AS class_level,
            $3::text AS subject,
            nullif(trim($4::text), '') AS chapter
        ),
        inserted_boards AS (
          INSERT INTO boards (id, code, name, inserted_at, updated_at)
          SELECT gen_random_uuid(), upper(board), upper(board), now(), now()
          FROM input
          ON CONFLICT (lower(code)) DO NOTHING
          RETURNING id
        ),
        inserted_classes AS (
          INSERT INTO school_classes (id, board_id, level, name, inserted_at, updated_at)
          SELECT gen_random_uuid(), b.id, i.class_level, 'Class ' || i.class_level, now(), now()
          FROM input i
          JOIN boards b ON lower(b.code) = lower(i.board)
          ON CONFLICT (board_id, level) DO NOTHING
          RETURNING id
        ),
        inserted_subjects AS (
          INSERT INTO subjects (id, school_class_id, name, slug, inserted_at, updated_at)
          SELECT gen_random_uuid(), sc.id, i.subject, lower(regexp_replace(i.subject, '[^a-zA-Z0-9]+', '-', 'g')), now(), now()
          FROM input i
          JOIN boards b ON lower(b.code) = lower(i.board)
          JOIN school_classes sc ON sc.board_id = b.id AND sc.level = i.class_level
          ON CONFLICT (school_class_id, lower(name)) DO NOTHING
          RETURNING id
        ),
        inserted_chapters AS (
          INSERT INTO chapters (id, subject_id, name, slug, position, inserted_at, updated_at)
          SELECT
            gen_random_uuid(),
            s.id,
            i.chapter,
            lower(regexp_replace(i.chapter, '[^a-zA-Z0-9]+', '-', 'g')),
            COALESCE((SELECT max(position) + 1 FROM chapters WHERE subject_id = s.id), 1),
            now(),
            now()
          FROM input i
          JOIN boards b ON lower(b.code) = lower(i.board)
          JOIN school_classes sc ON sc.board_id = b.id AND sc.level = i.class_level
          JOIN subjects s ON s.school_class_id = sc.id AND lower(s.name) = lower(i.subject)
          WHERE i.chapter IS NOT NULL
            AND lower(i.chapter) NOT IN ('prelims', 'appendix', 'answers part 1', 'answers part 2')
          ON CONFLICT (subject_id, lower(name)) DO NOTHING
          RETURNING id
        )
        SELECT c.id::text
        FROM input i
        JOIN boards b ON lower(b.code) = lower(i.board)
        JOIN school_classes sc ON sc.board_id = b.id AND sc.level = i.class_level
        JOIN subjects s ON s.school_class_id = sc.id AND lower(s.name) = lower(i.subject)
        LEFT JOIN chapters c ON c.subject_id = s.id AND lower(c.name) = lower(i.chapter)
        LIMIT 1
        """,
        [board, to_string(class_level), subject, chapter]
      )

    case rows do
      [[chapter_id]] when is_binary(chapter_id) ->
        Logging.debug("sources.catalog.ensure_entry.completed", %{
          chapter: chapter,
          chapter_id: chapter_id
        })

        chapter_id

      _ ->
        fetch_catalog_chapter_id(board, class_level, subject, chapter)
    end
  rescue
    error ->
      Logging.error("sources.catalog.ensure_entry.failed", %{
        board: board,
        class_level: class_level,
        subject: subject,
        chapter: chapter,
        error: Exception.message(error)
      })

      nil
  end

  def ensure_catalog_entry(_metadata), do: nil

  defp fetch_catalog_chapter_id(_board, _class_level, _subject, chapter)
       when chapter in [nil, ""],
       do: nil

  defp fetch_catalog_chapter_id(board, class_level, subject, chapter) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT c.id::text
        FROM boards b
        JOIN school_classes sc ON sc.board_id = b.id
        JOIN subjects s ON s.school_class_id = sc.id
        JOIN chapters c ON c.subject_id = s.id
        WHERE lower(b.code) = lower($1)
          AND sc.level = $2
          AND lower(s.name) = lower($3)
          AND lower(c.name) = lower($4)
        LIMIT 1
        """,
        [board, to_string(class_level), subject, chapter]
      )

    case rows do
      [[chapter_id]] when is_binary(chapter_id) ->
        Logging.debug("sources.catalog.ensure_entry.fetched_existing", %{
          chapter: chapter,
          chapter_id: chapter_id
        })

        chapter_id

      _ ->
        Logging.warning("sources.catalog.ensure_entry.no_chapter_id", %{chapter: chapter})
        nil
    end
  end

  def replace_chapter_sections(nil, _sections), do: :ok

  def replace_chapter_sections(chapter_id, sections) when is_list(sections) do
    Logging.info("sources.catalog.replace_chapter_sections.started", %{
      chapter_id: chapter_id,
      section_count: length(sections)
    })

    Repo.transaction(fn ->
      SQL.query!(
        Repo,
        "DELETE FROM chapter_sections WHERE chapter_id = $1",
        [Ecto.UUID.dump!(chapter_id)]
      )

      sections
      |> Enum.with_index(1)
      |> Enum.each(fn {section, index} ->
        SQL.query!(
          Repo,
          """
          INSERT INTO chapter_sections
            (id, chapter_id, name, section_type, position, metadata, inserted_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          ON CONFLICT (chapter_id, lower(name)) DO UPDATE
          SET section_type = EXCLUDED.section_type,
              position = EXCLUDED.position,
              metadata = EXCLUDED.metadata,
              updated_at = EXCLUDED.updated_at
          """,
          [
            Ecto.UUID.dump!(Ecto.UUID.generate()),
            Ecto.UUID.dump!(chapter_id),
            section.name,
            section.type,
            section[:position] || index,
            section[:metadata] || %{},
            DateTime.utc_now() |> DateTime.truncate(:second)
          ]
        )
      end)
    end)

    Logging.info("sources.catalog.replace_chapter_sections.completed", %{
      chapter_id: chapter_id,
      section_count: length(sections)
    })

    :ok
  rescue
    error ->
      Logging.error("sources.catalog.replace_chapter_sections.failed", %{
        chapter_id: chapter_id,
        error: Exception.message(error)
      })

      :error
  end

  defp list_catalog_chapters(filters) do
    params = [
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"])
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT c.name
        FROM chapters c
        JOIN subjects s ON s.id = c.subject_id
        JOIN school_classes sc ON sc.id = s.school_class_id
        JOIN boards b ON b.id = sc.board_id
        WHERE ($1::text IS NULL OR lower(b.code) = lower($1) OR lower(b.name) = lower($1))
          AND ($2::text IS NULL OR sc.level = $2)
          AND ($3::text IS NULL OR lower(s.name) = lower($3))
        ORDER BY c.position NULLS LAST, c.name ASC
        """,
        params
      )

    Enum.map(rows, fn [chapter] -> chapter end)
  rescue
    _ -> list_source_document_chapters(filters)
  end

  defp list_source_document_chapters(filters) do
    params = [
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"])
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT DISTINCT chapter
        FROM source_documents
        WHERE chapter IS NOT NULL
          AND chapter <> ''
          AND lower(source_type) = 'ncert'
          AND lower(chapter) NOT IN ('prelims', 'appendix', 'answers part 1', 'answers part 2')
          AND ($1::text IS NULL OR lower(board) = lower($1))
          AND ($2::text IS NULL OR class_level = $2)
          AND ($3::text IS NULL OR lower(subject) = lower($3))
        ORDER BY chapter ASC
        """,
        params
      )

    Enum.map(rows, fn [chapter] -> chapter end)
  rescue
    _ -> []
  end

  def search_ncert_chunks(filters, query, limit) do
    Logging.info("sources.search_ncert_chunks.started", %{
      filters: filters,
      query: query,
      limit: limit
    })

    search_source_chunks("ncert", filters, query, limit)
  end

  def search_pyq_chunks(filters, query, limit) do
    Logging.info("sources.search_pyq_chunks.started", %{
      filters: filters,
      query: query,
      limit: limit
    })

    search_source_chunks("pyq", filters, query, limit)
  end

  def marking_scheme_context(filters) do
    Logging.info("sources.marking_scheme_context.started", %{filters: filters})

    params = [
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"])
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT d.title, c.content
        FROM source_chunks c
        JOIN source_documents d ON d.id = c.source_document_id
        WHERE lower(d.source_type) = 'pyq'
          AND ($1::text IS NULL OR lower(d.board) = lower($1))
          AND ($2::text IS NULL OR d.class_level = $2)
          AND ($3::text IS NULL OR lower(d.subject) = lower($3))
          AND (
            c.content ILIKE '%General Instructions%'
            OR c.content ILIKE '%SECTION A%'
            OR c.content ILIKE '%Time allowed%'
            OR c.content ILIKE '%Maximum Marks%'
          )
        ORDER BY d.title ASC
        LIMIT 8
        """,
        params
      )

    result =
      rows
      |> Enum.map(fn [title, content] -> {title, content} end)
      |> build_marking_scheme(filters)

    Logging.info("sources.marking_scheme_context.completed", %{
      filters: filters,
      found: result[:found],
      section_count: result |> Map.get(:sections, []) |> length(),
      maximum_marks: result[:maximum_marks]
    })

    result
  rescue
    error ->
      Logging.error("sources.marking_scheme_context.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      %{
        found: false,
        sections: [],
        warnings: ["No PYQ marking-scheme context found in owned corpus."]
      }
  end

  def retrieval_preview(filters) do
    Logging.info("sources.retrieval_preview.started", %{filters: filters})

    query = retrieval_query(filters)
    ncert_questions = search_ncert_questions(filters, 20)
    ncert = search_ncert_chunks(filters, query, max(0, 8 - length(ncert_questions)))
    pyq_questions = search_pyq_questions(filters, 8)
    pyq_chunks = search_pyq_chunks(filters, query, max(0, 8 - length(pyq_questions)))
    question_bank = QuestionBank.result_blocks(filters, 8)
    marking_scheme = marking_scheme_context(filters)
    section_sources = section_sources(filters, ncert_questions, pyq_questions)

    preview = %{
      catalog: catalog_context(filters),
      ncert: Enum.map(ncert_questions ++ ncert, &preview_result/1),
      pyq: Enum.map(pyq_questions ++ pyq_chunks, &preview_result/1),
      question_bank: Enum.map(question_bank, &preview_result/1),
      marking_scheme: marking_scheme,
      section_sources: section_sources,
      warnings:
        retrieval_warnings(
          ncert_questions ++ ncert,
          pyq_questions ++ pyq_chunks,
          question_bank,
          marking_scheme
        )
    }

    record_retrieval_preview(filters, preview)

    Logging.info("sources.retrieval_preview.completed", %{
      ncert_count: length(preview.ncert),
      pyq_count: length(preview.pyq),
      question_bank_count: length(preview.question_bank),
      warning_count: length(preview.warnings)
    })

    preview
  end

  def import_question_from_source(source_type, id, request \\ %{}) do
    Logging.info("sources.import_question_from_source.started", %{
      source_type: source_type,
      id: id,
      request: Map.take(request, ["board", "class_level", "subject", "chapter", "topic"])
    })

    result =
      case source_type do
        "question_bank" -> import_question_bank_item(id)
        "ncert_question" -> import_ncert_question(id)
        "pyq_question" -> import_pyq_question(id)
        "pyq" -> import_source_chunk(id, "pyq")
        "ncert" -> import_source_chunk(id, "ncert")
        "source_chunk" -> import_source_chunk(id, nil)
        _ -> {:error, :unsupported_source_type}
      end

    case result do
      {:ok, question} ->
        merged =
          question
          |> repair_question_structure()
          |> merge_question_defaults(request)

        Logging.info("sources.import_question_from_source.completed", %{
          source_type: source_type,
          id: id
        })

        {:ok, merged}

      {:error, reason} ->
        Logging.warning("sources.import_question_from_source.failed", %{
          source_type: source_type,
          id: id,
          reason: inspect(reason)
        })

        {:error, reason}
    end
  end

  defp search_source_chunks(source_type, filters, query, limit) do
    limit = normalize_limit(limit)
    like_query = "%#{query || ""}%"
    chapter_scope = filters["chapter_scope"] || "single"
    chapters = normalize_chapters(filters)

    chapter =
      if source_type == "pyq" or chapter_scope == "full_syllabus" or chapters != [],
        do: nil,
        else: blank_to_nil(filters["chapter"])

    topic = if source_type == "pyq", do: nil, else: blank_to_nil(filters["topic"])
    broad_context = broad_context?(source_type, query, chapter_scope, chapters, chapter)

    params = [
      source_type,
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"]),
      chapter,
      topic,
      like_query,
      limit,
      chapters,
      broad_context
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          c.id::text,
          d.id::text,
          d.source_type,
          d.title,
          left(c.content, 1200) AS excerpt,
          c.content,
          c.tags,
          d.board,
          d.class_level,
          d.subject,
          d.chapter,
          d.topic,
          d.chapter_id::text,
          ch.position
        FROM source_chunks c
        JOIN source_documents d ON d.id = c.source_document_id
        LEFT JOIN chapters ch ON ch.id = d.chapter_id
        WHERE lower(d.source_type) = lower($1)
          AND ($2::text IS NULL OR lower(d.board) = lower($2))
          AND ($3::text IS NULL OR d.class_level = $3)
          AND ($4::text IS NULL OR lower(d.subject) = lower($4))
          AND ($5::text IS NULL OR lower(d.chapter) = lower($5))
          AND ($6::text IS NULL OR lower(d.topic) = lower($6))
          AND (
            lower($1) = 'pyq'
            OR
            cardinality($9::text[]) = 0
            OR lower(d.chapter) = ANY(SELECT lower(unnest($9::text[])))
            OR lower(ch.name) = ANY(SELECT lower(unnest($9::text[])))
          )
          AND ($10::boolean OR $7 = '%%' OR c.content ILIKE $7 OR d.title ILIKE $7 OR d.chapter ILIKE $7)
        ORDER BY
          CASE WHEN c.content ILIKE $7 THEN 0 ELSE 1 END,
          ch.position NULLS LAST,
          d.title ASC
        LIMIT $8
        """,
        params
      )

    results =
      Enum.map(rows, fn [
                          chunk_id,
                          document_id,
                          row_source_type,
                          title,
                          excerpt,
                          content,
                          tags,
                          board,
                          class_level,
                          subject,
                          chapter,
                          topic,
                          chapter_id,
                          chapter_position
                        ] ->
        metadata = %{
          board: board,
          class_level: class_level,
          subject: subject,
          chapter: chapter,
          topic: topic,
          chapter_id: chapter_id,
          chapter_position: chapter_position
        }

        %{
          id: chunk_id,
          chunk_id: chunk_id,
          document_id: document_id,
          source_type: row_source_type,
          title: title,
          excerpt: excerpt,
          content_excerpt: excerpt,
          metadata: metadata,
          tags: normalize_tags(tags),
          catalog:
            Map.take(metadata, [
              :board,
              :class_level,
              :subject,
              :chapter,
              :topic,
              :chapter_id,
              :chapter_position
            ]),
          signals: source_signals(row_source_type, content || excerpt || ""),
          citation: citation(row_source_type, title, chapter, chunk_id)
        }
      end)

    # This log captures the final retrieval shape that the AI sees without
    # dumping complete source text. It is the first place to inspect when the
    # generated paper ignores a chapter, source, or PYQ format.
    Logging.info("sources.search_source_chunks.completed", %{
      source_type: source_type,
      filters: filters,
      query: query,
      limit: limit,
      broad_context: broad_context,
      result_count: length(results),
      citations: Enum.map(results, & &1.citation)
    })

    results
  rescue
    error ->
      Logging.error("sources.search_source_chunks.failed", %{
        source_type: source_type,
        filters: filters,
        query: query,
        error: Exception.message(error)
      })

      []
  end

  defp search_ncert_questions(filters, limit) do
    params = [
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"]),
      normalize_chapters(filters),
      blank_to_nil(filters["topic"]),
      normalize_limit(limit)
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          id::text,
          board,
          class_level,
          subject,
          chapter,
          topic,
          section_label,
          section_type,
          question_number,
          question_type,
          marks,
          difficulty,
          left(text, 1200) AS excerpt,
          tags
        FROM ncert_questions
        WHERE ($1::text IS NULL OR lower(board) = lower($1))
          AND ($2::text IS NULL OR class_level = $2)
          AND ($3::text IS NULL OR lower(subject) = lower($3))
          AND (cardinality($4::text[]) = 0 OR lower(chapter) = ANY(SELECT lower(unnest($4::text[]))))
          AND ($5::text IS NULL OR lower(topic) = lower($5) OR text ILIKE '%' || $5 || '%')
        ORDER BY chapter, section_label, question_number NULLS LAST
        LIMIT $6
        """,
        params
      )

    Enum.map(rows, fn [
                        id,
                        board,
                        class_level,
                        subject,
                        chapter,
                        topic,
                        section_label,
                        section_type,
                        question_number,
                        question_type,
                        marks,
                        difficulty,
                        excerpt,
                        tags
                      ] ->
      %{
        id: id,
        source_type: "ncert_question",
        title:
          [chapter, section_label, question_number && "Q#{question_number}"]
          |> Enum.reject(&is_nil/1)
          |> Enum.join(" / "),
        excerpt: excerpt,
        content_excerpt: excerpt,
        citation:
          "NCERT / #{chapter || "unknown"} / #{section_label || "section"} / Q#{question_number || "?"}",
        metadata: %{
          board: board,
          class_level: class_level,
          subject: subject,
          chapter: chapter,
          topic: topic,
          section_label: section_label,
          section_type: section_type
        },
        signals: %{
          probable_question_type: question_type,
          marks: marks,
          section_label: section_label,
          pyq_pattern: false
        },
        marks: marks,
        difficulty: difficulty,
        question_type: question_type,
        tags: normalize_tags(tags)
      }
    end)
  rescue
    error ->
      Logging.error("sources.search_ncert_questions.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      []
  end

  defp search_pyq_questions(filters, limit) do
    params = [
      blank_to_nil(filters["board"]),
      blank_to_nil(filters["class_level"]),
      blank_to_nil(filters["subject"]),
      normalize_chapters(filters),
      blank_to_nil(filters["topic"]),
      normalize_limit(limit)
    ]

    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT
          id::text,
          board,
          class_level,
          subject,
          chapter,
          topic,
          section_label,
          question_number,
          question_type,
          marks,
          difficulty,
          left(text, 1200) AS excerpt,
          paper_code,
          series,
          year,
          tags
        FROM pyq_questions
        WHERE ($1::text IS NULL OR lower(board) = lower($1))
          AND ($2::text IS NULL OR class_level = $2)
          AND ($3::text IS NULL OR lower(subject) = lower($3))
          AND (cardinality($4::text[]) = 0 OR lower(chapter) = ANY(SELECT lower(unnest($4::text[]))))
          AND ($5::text IS NULL OR lower(topic) = lower($5) OR text ILIKE '%' || $5 || '%')
        ORDER BY year DESC NULLS LAST, section_label NULLS LAST, question_number NULLS LAST
        LIMIT $6
        """,
        params
      )

    Enum.map(rows, fn [
                        id,
                        board,
                        class_level,
                        subject,
                        chapter,
                        topic,
                        section_label,
                        question_number,
                        question_type,
                        marks,
                        difficulty,
                        excerpt,
                        paper_code,
                        series,
                        year,
                        tags
                      ] ->
      %{
        id: id,
        source_type: "pyq_question",
        title:
          [year, paper_code, section_label, question_number]
          |> Enum.reject(&is_nil/1)
          |> Enum.join(" / "),
        excerpt: excerpt,
        content_excerpt: excerpt,
        citation: "PYQ / #{paper_code || series || year || id} / Q#{question_number || "?"}",
        metadata: %{
          board: board,
          class_level: class_level,
          subject: subject,
          chapter: chapter,
          topic: topic
        },
        signals: %{
          probable_question_type: question_type,
          marks: marks,
          section_label: section_label,
          pyq_pattern: true
        },
        marks: marks,
        difficulty: difficulty,
        question_type: question_type,
        tags: normalize_tags(tags)
      }
    end)
  rescue
    error ->
      Logging.error("sources.search_pyq_questions.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      []
  end

  defp normalize_limit(limit) when is_integer(limit), do: limit |> max(1) |> min(20)

  defp normalize_limit(limit) when is_binary(limit) do
    case Integer.parse(limit) do
      {number, _} -> normalize_limit(number)
      :error -> 5
    end
  end

  defp normalize_limit(_limit), do: 5

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
    |> maybe_warn(ncert == [], "No NCERT context found for the selected filters.")
    |> maybe_warn(pyq == [], "No PYQ examples found for the selected filters.")
    |> maybe_warn(question_bank == [], "No saved question-bank items matched these filters.")
    |> maybe_warn(not marking_scheme[:found], "No owned PYQ marking-scheme context found.")
  end

  defp maybe_warn(warnings, true, warning), do: warnings ++ [warning]
  defp maybe_warn(warnings, false, _warning), do: warnings

  defp section_sources(filters, ncert_questions, pyq_questions) do
    catalog = catalog_context(filters)
    ncert_by_section = group_source_questions(ncert_questions)
    pyq_by_section = group_source_questions(pyq_questions)

    chapters =
      catalog.chapters
      |> Enum.map(fn chapter ->
        chapter_name = chapter[:name]
        catalog_sections = normalize_json_value(chapter[:sections] || [])

        section_names =
          (Enum.map(catalog_sections, & &1["name"]) ++
             section_names_for_chapter(ncert_by_section, chapter_name) ++
             section_names_for_chapter(pyq_by_section, chapter_name))
          |> Enum.reject(&(&1 in [nil, ""]))
          |> Enum.uniq_by(&String.downcase(to_string(&1)))

        %{
          name: chapter_name,
          position: chapter[:position],
          sections:
            Enum.map(section_names, fn section_name ->
              catalog_section =
                Enum.find(catalog_sections, fn section ->
                  String.downcase(to_string(section["name"])) ==
                    String.downcase(to_string(section_name))
                end)

              section_type = catalog_section && catalog_section["section_type"]
              key = section_key(chapter_name, section_name)

              %{
                name: section_name,
                section_type: section_type || source_section_type(section_name),
                ncert: Enum.map(Map.get(ncert_by_section, key, []), &preview_result/1),
                pyq: Enum.map(Map.get(pyq_by_section, key, []), &preview_result/1)
              }
            end)
        }
      end)
      |> Enum.reject(fn chapter ->
        chapter.sections == [] and not has_chapter_sources?(ncert_by_section, chapter.name) and
          not has_chapter_sources?(pyq_by_section, chapter.name)
      end)

    %{
      chapters: chapters,
      ncert_count: length(ncert_questions),
      pyq_count: length(pyq_questions)
    }
  rescue
    error ->
      Logging.error("sources.section_sources.failed", %{
        filters: filters,
        error: Exception.message(error)
      })

      %{chapters: [], ncert_count: length(ncert_questions), pyq_count: length(pyq_questions)}
  end

  defp group_source_questions(questions) do
    Enum.group_by(questions, fn question ->
      metadata = question[:metadata] || %{}
      chapter = metadata[:chapter] || metadata["chapter"]

      section =
        metadata[:section_label] || metadata["section_label"] ||
          get_in(question, [:signals, :section_label])

      section_key(chapter, section)
    end)
  end

  defp section_names_for_chapter(grouped, chapter) do
    grouped
    |> Map.keys()
    |> Enum.filter(fn {key_chapter, _section} ->
      String.downcase(to_string(key_chapter)) == String.downcase(to_string(chapter))
    end)
    |> Enum.map(fn {_chapter, section} -> section end)
  end

  defp has_chapter_sources?(grouped, chapter),
    do: section_names_for_chapter(grouped, chapter) != []

  defp section_key(chapter, section) do
    {chapter, section || "Direct questions"}
  end

  defp source_section_type(section_name) do
    cond do
      Regex.match?(~r/^exercise/i, to_string(section_name)) -> "exercise"
      Regex.match?(~r/^example/i, to_string(section_name)) -> "example"
      Regex.match?(~r/^section\s+[a-e]/i, to_string(section_name)) -> "pyq"
      true -> "source"
    end
  end

  defp preview_result(result) do
    %{
      id: result[:id] || result[:chunk_id],
      source_type: result[:source_type],
      title: result[:title] || result[:citation],
      excerpt: result[:excerpt] || result[:content_excerpt] || result[:text],
      citation: result[:citation],
      metadata: result[:metadata] || result[:catalog],
      signals: result[:signals] || %{},
      marks: result[:marks] || get_in(result, [:signals, :marks]),
      difficulty: result[:difficulty],
      question_type: result[:question_type] || get_in(result, [:signals, :probable_question_type])
    }
  end

  defp record_retrieval_preview(filters, preview) do
    %Postgrex.Result{rows: [[run_id]]} =
      SQL.query!(
        Repo,
        """
        INSERT INTO retrieval_runs (id, request, status, summary, inserted_at, updated_at)
        VALUES (gen_random_uuid(), $1, 'completed', $2, now(), now())
        RETURNING id::text
        """,
        [
          filters,
          %{
            ncert_count: length(preview.ncert),
            pyq_count: length(preview.pyq),
            question_bank_count: length(preview.question_bank),
            warnings: preview.warnings
          }
        ]
      )

    (preview.ncert ++ preview.pyq ++ preview.question_bank)
    |> Enum.with_index(1)
    |> Enum.each(fn {result, rank} ->
      SQL.query!(
        Repo,
        """
        INSERT INTO retrieval_results
          (id, retrieval_run_id, source_type, source_id, rank, payload, inserted_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now())
        """,
        [Ecto.UUID.dump!(run_id), result.source_type, result.id, rank, result]
      )
    end)
  rescue
    error ->
      Logging.error("sources.retrieval_preview.record_failed", %{error: Exception.message(error)})
      :ok
  end

  defp import_question_bank_item(id) do
    case Repo.get(QuestionBankItem, id) do
      nil ->
        {:error, :not_found}

      item ->
        {:ok,
         %{
           "id" => Ecto.UUID.generate(),
           "text" => item.text,
           "richText" => item.rich_text,
           "marks" => item.marks || 1,
           "type" => item.question_type || "SA",
           "difficulty" => item.difficulty || "Medium",
           "source" => item.source || "Question bank",
           "topic" => item.topic,
           "answer" => item.answer || "",
           "answerRichText" => item.answer_rich_text,
           "tags" => item.tags || [],
           "sourceCitations" => ["QUESTION BANK / #{item.id}"]
         }}
    end
  end

  defp import_ncert_question(id) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT text, answer, marks, question_type, difficulty, topic, chapter, section_label, question_number, tags
        FROM ncert_questions
        WHERE id = $1
        LIMIT 1
        """,
        [Ecto.UUID.dump!(id)]
      )

    case rows do
      [
        [
          text,
          answer,
          marks,
          question_type,
          difficulty,
          topic,
          chapter,
          section_label,
          question_number,
          tags
        ]
      ] ->
        {:ok,
         %{
           "id" => Ecto.UUID.generate(),
           "text" => text,
           "marks" => marks || 1,
           "type" => question_type || "NCERT Exercise",
           "difficulty" => difficulty || difficulty_from_marks(marks),
           "source" => "NCERT",
           "topic" => topic || chapter,
           "answer" => answer || "",
           "tags" => tags_to_list(tags),
           "sourceCitations" => [
             "NCERT / #{chapter || "unknown"} / #{section_label || "section"} / Q#{question_number || "?"}"
           ]
         }}

      _ ->
        {:error, :not_found}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  defp import_pyq_question(id) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT text, answer, marks, question_type, difficulty, topic, chapter, paper_code, question_number, tags
        FROM pyq_questions
        WHERE id = $1
        LIMIT 1
        """,
        [Ecto.UUID.dump!(id)]
      )

    case rows do
      [
        [
          text,
          answer,
          marks,
          question_type,
          difficulty,
          topic,
          chapter,
          paper_code,
          question_number,
          tags
        ]
      ] ->
        {:ok,
         %{
           "id" => Ecto.UUID.generate(),
           "text" => text,
           "marks" => marks || 1,
           "type" => question_type || "SA",
           "difficulty" => difficulty || difficulty_from_marks(marks),
           "source" => "PYQ",
           "topic" => topic || chapter,
           "answer" => answer || "",
           "tags" => tags_to_list(tags),
           "sourceCitations" => ["PYQ / #{paper_code || "unknown"} / Q#{question_number || "?"}"]
         }}

      _ ->
        {:error, :not_found}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  defp import_source_chunk(id, source_type) do
    %Postgrex.Result{rows: rows} =
      SQL.query!(
        Repo,
        """
        SELECT d.source_type, d.title, d.chapter, d.topic, c.content, c.tags
        FROM source_chunks c
        JOIN source_documents d ON d.id = c.source_document_id
        WHERE c.id = $1
          AND ($2::text IS NULL OR lower(d.source_type) = lower($2))
        LIMIT 1
        """,
        [Ecto.UUID.dump!(id), source_type]
      )

    case rows do
      [[row_source_type, title, chapter, topic, content, tags]] ->
        marks = extract_marks(content) || 1

        {:ok,
         %{
           "id" => Ecto.UUID.generate(),
           "text" => String.slice(to_string(content), 0, 1800),
           "marks" => marks,
           "type" => probable_question_type(content) || "SA",
           "difficulty" => difficulty_from_marks(marks),
           "source" => String.upcase(to_string(row_source_type)),
           "topic" => topic || chapter,
           "answer" => "",
           "tags" => tags_to_list(tags),
           "sourceCitations" => [citation(row_source_type, title, chapter, id)]
         }}

      _ ->
        {:error, :not_found}
    end
  rescue
    error -> {:error, Exception.message(error)}
  end

  defp merge_question_defaults(question, request) do
    question
    |> Map.put_new("topic", request["topic"] || request["chapter"])
    |> Map.put_new("difficulty", request["difficulty"] || "Medium")
  end

  defp repair_question_structure(question) when is_map(question) do
    text = to_string(question["text"] || "")
    options = question["options"] |> List.wrap() |> Enum.reject(&(&1 in [nil, ""]))
    subparts = question["subparts"] || question["sub_parts"] || []

    cond do
      options != [] or subparts != [] ->
        question

      true ->
        case split_inline_blocks(text) do
          %{kind: :options, stem: stem, blocks: blocks} ->
            question
            |> Map.put("text", stem)
            |> Map.put("richText", "")
            |> Map.put("options", blocks)

          %{kind: :subparts, stem: stem, blocks: blocks} ->
            question
            |> Map.put("text", stem)
            |> Map.put("richText", "")
            |> Map.put("subparts", blocks)

          nil ->
            question
        end
    end
  end

  defp repair_question_structure(question), do: question

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
            "id" => Ecto.UUID.generate(),
            "label" => Enum.at(labels, index),
            "text" =>
              text |> String.slice(content_start, content_end - content_start) |> String.trim(),
            "richText" => ""
          }
        end)
        |> Enum.reject(&(&1["text"] == ""))

      kind =
        if Enum.all?(labels, &Regex.match?(~r/^\([a-e]\)$/i, &1)),
          do: :subparts,
          else: :options

      blocks =
        if kind == :subparts do
          blocks
          |> Enum.with_index()
          |> Enum.map(fn {block, index} ->
            block
            |> Map.put("label", <<97 + index::utf8>>)
            |> Map.put("marks", 1)
            |> Map.put("answer", "")
          end)
        else
          blocks
        end

      %{kind: kind, stem: stem, blocks: blocks}
    end
  end

  defp split_inline_blocks(_text), do: nil

  defp difficulty_from_marks(marks) when is_integer(marks) and marks <= 1, do: "Low"
  defp difficulty_from_marks(marks) when is_integer(marks) and marks <= 3, do: "Medium"
  defp difficulty_from_marks(_marks), do: "High"

  defp tags_to_list(tags) do
    tags
    |> normalize_tags()
    |> Map.values()
    |> Enum.map(&to_string/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp blank_to_nil(value) when value in [nil, ""], do: nil
  defp blank_to_nil(value), do: to_string(value)

  defp normalize_chapters(%{"chapter_scope" => "multiple", "chapters" => chapters}) do
    chapters |> List.wrap() |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_chapters(%{"chapters" => chapters}) when is_list(chapters) do
    chapters |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_chapters(_filters), do: []

  defp context_chapters(%{"chapters" => chapters}) when is_list(chapters) and chapters != [] do
    normalize_chapters(%{"chapters" => chapters})
  end

  defp context_chapters(%{"chapter" => chapter}) when chapter not in [nil, ""] do
    [to_string(chapter)]
  end

  defp context_chapters(_filters), do: []

  defp broad_context?("ncert", query, chapter_scope, chapters, chapter) do
    query_blank = String.trim(to_string(query || "")) == ""
    query_blank or chapter_scope == "full_syllabus" or chapters != [] or chapter not in [nil, ""]
  end

  defp broad_context?("pyq", _query, _chapter_scope, _chapters, _chapter) do
    # PYQs are used both as chapter examples and as board-format inspiration.
    # A chapter may have NCERT coverage but no exact tagged PYQ question in the
    # current owned paper. In that case we still return board/class/subject PYQ
    # chunks so NCERT + PYQ generation can use real exam format evidence instead
    # of failing despite having an owned PYQ corpus.
    true
  end

  defp broad_context?(_, _, _, _, _), do: false

  defp build_marking_scheme([], _filters) do
    %{
      found: false,
      sections: [],
      warnings: ["No PYQ marking-scheme context found in owned corpus."]
    }
  end

  defp build_marking_scheme(rows, filters) do
    text =
      rows
      |> Enum.map(fn {_title, content} -> content end)
      |> Enum.join("\n\n")
      |> String.replace(~r/\s+/, " ")

    sections = extract_pyq_sections(text)

    %{
      found: sections != [],
      source_titles: rows |> Enum.map(fn {title, _} -> title end) |> Enum.uniq(),
      board: filters["board"],
      class_level: filters["class_level"],
      subject: filters["subject"],
      total_questions: extract_int(text, ~r/contains\s+(\d+)\s+questions/i),
      duration: extract_text(text, ~r/Time\s+allowed\s*:\s*([^\.]+?)\s+Maximum\s+Marks/i),
      maximum_marks: extract_int(text, ~r/Maximum\s+Marks\s*:\s*(\d+)/i),
      sections: sections,
      warnings:
        if(sections == [],
          do: ["PYQ found, but no structured section pattern could be extracted."],
          else: []
        )
    }
  end

  defp extract_pyq_sections(text) do
    from_instructions =
      Regex.scan(
        ~r/In Section\s+([A-E]),\s*Questions?\s+no\.?\s*(\d+)\s*(?:to|-)\s*(\d+).*?(MCQs?|Assertion-Reason|VSA|SA|LA|case study).*?(\d+)\s*marks?\s+each/i,
        text
      )
      |> Enum.map(fn [_, label, from, to, type, marks] ->
        count = String.to_integer(to) - String.to_integer(from) + 1

        %{
          label: "Section #{String.upcase(label)}",
          question_from: String.to_integer(from),
          question_to: String.to_integer(to),
          question_count: count,
          question_type: normalize_question_type(type),
          marks_each: String.to_integer(marks),
          total_marks: count * String.to_integer(marks)
        }
      end)

    if from_instructions != [] do
      from_instructions
    else
      Regex.scan(
        ~r/SECTION\s+([A-E]).{0,220}?This section has\s+(\d+)\s+(.+?)\s+carrying\s+(\d+)\s+marks?\s+each/i,
        text
      )
      |> Enum.map(fn [_, label, count, type, marks] ->
        count = String.to_integer(count)
        marks = String.to_integer(marks)

        %{
          label: "Section #{String.upcase(label)}",
          question_count: count,
          question_type: normalize_question_type(type),
          marks_each: marks,
          total_marks: count * marks
        }
      end)
    end
  end

  defp normalize_question_type(type) do
    lower = String.downcase(to_string(type))

    cond do
      String.contains?(lower, "mcq") -> "MCQ"
      String.contains?(lower, "assertion") -> "Assertion-Reason"
      String.contains?(lower, "very short") or String.contains?(lower, "vsa") -> "VSA"
      String.contains?(lower, "short") or String.contains?(lower, "sa") -> "SA"
      String.contains?(lower, "long") or String.contains?(lower, "la") -> "LA"
      String.contains?(lower, "case") -> "Case Study"
      true -> String.trim(to_string(type))
    end
  end

  defp extract_int(text, regex) do
    case Regex.run(regex, text) do
      [_, value] -> String.to_integer(value)
      _ -> nil
    end
  end

  defp extract_text(text, regex) do
    case Regex.run(regex, text) do
      [_, value] -> String.trim(value)
      _ -> nil
    end
  end

  defp source_signals(source_type, content) do
    %{
      probable_question_type: probable_question_type(content),
      marks: extract_marks(content),
      section_label: extract_section_label(content),
      pyq_pattern: String.downcase(to_string(source_type)) == "pyq"
    }
  end

  defp probable_question_type(content) do
    lower = String.downcase(to_string(content))

    cond do
      Regex.match?(~r/\([a-d]\)|\bmcq\b|choose the correct/i, content) ->
        "MCQ"

      String.contains?(lower, "case study") or String.contains?(lower, "case-based") ->
        "Case Study"

      Regex.match?(~r/\bvery short\b|\bvsa\b/i, content) ->
        "VSA"

      Regex.match?(~r/\bshort answer\b|\bsa\b/i, content) ->
        "SA"

      Regex.match?(~r/\blong answer\b|\bla\b/i, content) ->
        "LA"

      true ->
        nil
    end
  end

  defp extract_marks(content) do
    case Regex.run(~r/\[?\(?\s*(\d+)\s*marks?\s*\)?\]?/i, to_string(content)) do
      [_, marks] -> String.to_integer(marks)
      _ -> nil
    end
  end

  defp extract_section_label(content) do
    case Regex.run(~r/\bsection\s+([a-e])\b/i, to_string(content)) do
      [_, section] -> "Section #{String.upcase(section)}"
      _ -> nil
    end
  end

  defp citation(source_type, title, chapter, chunk_id) do
    [String.upcase(to_string(source_type)), title, chapter, "chunk:#{chunk_id}"]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.join(" / ")
  end

  defp normalize_tags(value) when is_map(value), do: value

  defp normalize_tags(value) when is_binary(value) do
    case Jason.decode(value) do
      {:ok, decoded} when is_map(decoded) -> normalize_tags(decoded)
      {:ok, decoded} when is_binary(decoded) -> normalize_tags(decoded)
      _ -> %{}
    end
  end

  defp normalize_tags(_value), do: %{}

  defp normalize_json_value(value) when is_binary(value) do
    case Jason.decode(value) do
      {:ok, decoded} -> normalize_json_value(decoded)
      _ -> value
    end
  end

  defp normalize_json_value(value), do: value

  defp first_in([head | _], path), do: get_in(head, path)
  defp first_in([], _path), do: nil
end
