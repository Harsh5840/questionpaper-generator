defmodule Qpg.Sources.Cbse.PyqImport do
  @moduledoc """
  Imports processed CBSE PYQ text/PDF files into the shared source corpus.
  """

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.Repo
  alias Qpg.Sources.Cbse.PyqTagger

  @supported_extensions [".txt", ".md", ".pdf"]
  @chunk_size 1_800
  @overlap 180

  def ingest_path(path, opts \\ []) do
    expanded = Path.expand(path)
    Logging.info("sources.pyq.import.path.started", %{path: expanded, opts: opts})

    files = collect_files(expanded)

    Logging.info("sources.pyq.import.path.files_discovered", %{
      path: expanded,
      file_count: length(files)
    })

    files
    |> Enum.map(&ingest_file(&1, opts))
    |> tap(fn results ->
      Logging.info("sources.pyq.import.path.completed", %{
        path: expanded,
        ok_count: Enum.count(results, &(&1.status == :ok)),
        error_count: Enum.count(results, &(&1.status == :error))
      })
    end)
  end

  def ingest_file(path, opts \\ []) do
    metadata = metadata_from_path(path, opts)

    Logging.info("sources.pyq.import.file.started", %{path: path, metadata: metadata})

    with {:ok, content, extraction_note} <- read_content(path),
         chunks when chunks != [] <- chunk_text(content) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)
      document_id = Ecto.UUID.generate()

      # PYQ files are replaced by identity, keeping re-runs deterministic after
      # a better sidecar text/PDF extraction is added.
      Repo.transaction(fn ->
        delete_existing_document(metadata)
        delete_existing_pyq_questions(metadata)
        insert_document(document_id, metadata, now)
        insert_chunks(document_id, chunks, metadata, path, extraction_note, now)
        insert_pyq_questions(document_id, content, metadata)
      end)

      Logging.info("sources.pyq.import.file.completed", %{
        path: path,
        title: metadata.title,
        document_id: document_id,
        chunk_count: length(chunks),
        extraction_note: extraction_note
      })

      %{
        file: path,
        status: :ok,
        title: metadata.title,
        chunks: length(chunks),
        note: extraction_note
      }
    else
      {:error, reason} ->
        Logging.error("sources.pyq.import.file.failed", %{
          path: path,
          metadata: metadata,
          reason: reason
        })

        %{file: path, status: :error, reason: reason}

      [] ->
        reason = "No readable content after extraction"

        Logging.error("sources.pyq.import.file.failed", %{
          path: path,
          metadata: metadata,
          reason: reason
        })

        %{file: path, status: :error, reason: reason}
    end
  end

  defp collect_files(path) do
    cond do
      File.regular?(path) ->
        if supported?(path), do: [path], else: []

      File.dir?(path) ->
        path
        |> Path.join("**/*")
        |> Path.wildcard()
        |> Enum.filter(&(File.regular?(&1) && supported?(&1)))

      true ->
        []
    end
  end

  defp supported?(path), do: String.downcase(Path.extname(path)) in @supported_extensions

  defp read_content(path) do
    case String.downcase(Path.extname(path)) do
      ext when ext in [".txt", ".md"] -> {:ok, File.read!(path), "direct_text"}
      ".pdf" -> read_pdf_content(path)
    end
  end

  defp read_pdf_content(path) do
    sidecar = Path.rootname(path) <> ".txt"

    cond do
      File.exists?(sidecar) ->
        {:ok, File.read!(sidecar), "pdf_sidecar_text"}

      executable = System.find_executable("pdftotext") ->
        case System.cmd(executable, ["-layout", path, "-"], stderr_to_stdout: true) do
          {content, 0} -> {:ok, content, "pdftotext"}
          {error, _code} -> {:error, "pdftotext failed: #{String.slice(error, 0, 240)}"}
        end

      true ->
        {:error,
         "PDF found, but pdftotext is not available here. Add #{Path.basename(sidecar)} beside it."}
    end
  end

  defp metadata_from_path(path, opts) do
    normalized = String.replace(path, "\\", "/")

    class_level =
      Regex.run(~r/class-(\d+)/, normalized) |> match_at(1, Keyword.get(opts, :class_level, "10"))

    subject =
      if String.contains?(normalized, "/maths/"),
        do: "Maths",
        else: Keyword.get(opts, :subject, "Maths")

    %{
      title: Keyword.get(opts, :title, Path.basename(path, Path.extname(path))),
      board: Keyword.get(opts, :board, "CBSE"),
      class_level: to_string(class_level),
      subject: subject,
      chapter: Keyword.get(opts, :chapter),
      topic: Keyword.get(opts, :topic)
    }
  end

  defp match_at(nil, _index, fallback), do: fallback
  defp match_at(match, index, fallback), do: Enum.at(match, index) || fallback

  defp insert_document(document_id, metadata, now) do
    SQL.query!(
      Repo,
      """
      INSERT INTO source_documents
        (id, source_type, title, board, class_level, subject, chapter, topic, inserted_at, updated_at)
      VALUES ($1, 'pyq', $2, $3, $4, $5, $6, $7, $8, $8)
      """,
      [
        Ecto.UUID.dump!(document_id),
        metadata.title,
        metadata.board,
        metadata.class_level,
        metadata.subject,
        metadata.chapter,
        metadata.topic,
        now
      ]
    )
  end

  defp insert_chunks(document_id, chunks, metadata, path, extraction_note, now) do
    chunks
    |> Enum.with_index(1)
    |> Enum.each(fn {chunk, index} ->
      SQL.query!(
        Repo,
        """
        INSERT INTO source_chunks
          (id, source_document_id, content, tags, inserted_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $5)
        """,
        [
          Ecto.UUID.dump!(Ecto.UUID.generate()),
          Ecto.UUID.dump!(document_id),
          chunk,
          %{
            "board" => metadata.board,
            "class_level" => metadata.class_level,
            "subject" => metadata.subject,
            "chapter" => metadata.chapter,
            "topic" => metadata.topic,
            "file" => Path.basename(path),
            "chunk_index" => index,
            "extraction_note" => extraction_note
          },
          now
        ]
      )
    end)
  end

  defp chunk_text(content) do
    content
    |> String.replace(~r/\r\n?/, "\n")
    |> String.replace(~r/[ \t]+/, " ")
    |> String.split(~r/\n{2,}/, trim: true)
    |> Enum.flat_map(&split_large_paragraph/1)
    |> pack_chunks()
  end

  defp split_large_paragraph(paragraph) when byte_size(paragraph) <= @chunk_size,
    do: [String.trim(paragraph)]

  defp split_large_paragraph(paragraph) do
    paragraph
    |> String.split(~r/(?<=[.!?])\s+/, trim: true)
    |> pack_chunks()
  end

  defp pack_chunks(parts) do
    {chunks, current} =
      Enum.reduce(parts, {[], ""}, fn part, {chunks, current} ->
        part = String.trim(part)
        combined = String.trim(current <> "\n\n" <> part)

        cond do
          part == "" ->
            {chunks, current}

          byte_size(combined) <= @chunk_size ->
            {chunks, combined}

          current == "" ->
            head = String.slice(part, 0, @chunk_size)
            tail_start = max(byte_size(part) - @overlap, 0)
            {[head | chunks], String.slice(part, tail_start, @overlap)}

          true ->
            overlap = current |> String.slice(max(byte_size(current) - @overlap, 0), @overlap)
            {[current | chunks], String.trim(overlap <> "\n\n" <> part)}
        end
      end)

    [current | chunks]
    |> Enum.reverse()
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp delete_existing_document(metadata) do
    SQL.query!(
      Repo,
      """
      DELETE FROM source_documents
      WHERE source_type = 'pyq'
        AND title = $1
        AND board = $2
        AND class_level = $3
        AND subject = $4
      """,
      [metadata.title, metadata.board, metadata.class_level, metadata.subject]
    )
  end

  defp delete_existing_pyq_questions(metadata) do
    SQL.query!(
      Repo,
      """
      DELETE FROM pyq_questions
      WHERE board = $1
        AND class_level = $2
        AND subject = $3
        AND (paper_code = $4 OR paper_code IS NULL)
      """,
      [metadata.board, metadata.class_level, metadata.subject, metadata.title]
    )
  rescue
    _ -> :ok
  end

  defp insert_pyq_questions(document_id, content, metadata) do
    questions = PyqTagger.extract_questions(content, metadata)

    Logging.info("sources.pyq.import.questions_extracted", %{
      title: metadata.title,
      count: length(questions)
    })

    Enum.each(questions, fn question ->
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
          metadata.board,
          metadata.class_level,
          metadata.subject,
          question.chapter || metadata.chapter,
          question.topic || metadata.topic,
          question.year,
          question.paper_code || metadata.title,
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
    end)
  rescue
    error ->
      Logging.error("sources.pyq.import.questions_failed", %{
        title: metadata.title,
        error: Exception.message(error)
      })

      :ok
  end

end
