defmodule Qpg.Sources.Ncert.Import do
  @moduledoc """
  Imports local NCERT raw files into searchable source chunks.
  """

  alias Ecto.Adapters.SQL
  alias Qpg.Logging
  alias Qpg.Repo
  alias Qpg.Sources
  alias Qpg.Sources.Ncert.Metadata
  alias Qpg.Sources.Ncert.QuestionExtractor

  @supported_extensions [".txt", ".md", ".pdf"]
  @chunk_size 1_800
  @overlap 180

  def ingest_path(path) do
    expanded = Path.expand(path)
    Logging.info("sources.ncert.import.path.started", %{path: expanded})

    files = collect_files(expanded)

    Logging.info("sources.ncert.import.path.files_discovered", %{
      path: expanded,
      file_count: length(files)
    })

    files
    |> Enum.map(&ingest_file/1)
    |> tap(fn results ->
      Logging.info("sources.ncert.import.path.completed", %{
        path: expanded,
        ok_count: Enum.count(results, &(&1.status == :ok)),
        error_count: Enum.count(results, &(&1.status == :error))
      })
    end)
  end

  def ingest_file(path) do
    metadata = Metadata.from_path(path)

    Logging.info("sources.ncert.import.file.started", %{
      path: path,
      metadata: metadata
    })

    with {:ok, content, extraction_note} <- read_content(path),
         chunks when chunks != [] <- chunk_text(content) do
      now = DateTime.utc_now() |> DateTime.truncate(:second)
      document_id = Ecto.UUID.generate()
      sections = extract_sections(content)

      # One file import is transactional so the document row, chunks, and
      # normalized chapter-section catalog never get out of sync.
      Repo.transaction(fn ->
        delete_existing_document(metadata)
        chapter_id = Sources.ensure_catalog_entry(metadata)
        insert_document(document_id, metadata, chapter_id, now)
        insert_chunks(document_id, chunks, metadata, path, extraction_note, now)
        Sources.replace_chapter_sections(chapter_id, sections)
        QuestionExtractor.insert_questions(document_id, content, Map.put(metadata, :chapter_id, chapter_id), now)
      end)

      Logging.info("sources.ncert.import.file.completed", %{
        path: path,
        title: metadata.title,
        document_id: document_id,
        chunk_count: length(chunks),
        section_count: length(sections),
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
        Logging.error("sources.ncert.import.file.failed", %{
          path: path,
          metadata: metadata,
          reason: reason
        })

        %{file: path, status: :error, reason: reason}

      [] ->
        reason = "No readable content after extraction"

        Logging.error("sources.ncert.import.file.failed", %{
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

  defp insert_document(document_id, metadata, chapter_id, now) do
    SQL.query!(
      Repo,
      """
      INSERT INTO source_documents
        (id, source_type, title, board, class_level, subject, chapter, topic, chapter_id, inserted_at, updated_at)
      VALUES ($1, 'ncert', $2, $3, $4, $5, $6, $7, $8, $9, $9)
      """,
      [
        Ecto.UUID.dump!(document_id),
        metadata.title,
        metadata.board,
        metadata.class_level,
        metadata.subject,
        metadata.chapter,
        metadata.topic,
        dump_uuid_or_nil(chapter_id),
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

  defp extract_sections(content) do
    content
    |> String.replace(~r/\r\n?/, "\n")
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.reduce([], fn line, sections ->
      cond do
        match = Regex.run(~r/^(\d+\.\d+)\s+(.{3,90})$/, line) ->
          [_, number, title] = match

          [
            %{
              name: "#{number} #{clean_heading(title)}",
              type: "concept",
              metadata: %{"source_line" => line}
            }
            | sections
          ]

        match = Regex.run(~r/^(EXERCISE\s+\d+(?:\.\d+)?)/i, line) ->
          [_, title] = match

          [
            %{name: clean_heading(title), type: "exercise", metadata: %{"source_line" => line}}
            | sections
          ]

        match = Regex.run(~r/^(EXAMPLE\s+\d+)/i, line) ->
          [_, title] = match

          [
            %{name: clean_heading(title), type: "example", metadata: %{"source_line" => line}}
            | sections
          ]

        true ->
          sections
      end
    end)
    |> Enum.reverse()
    |> Enum.uniq_by(&String.downcase(&1.name))
    |> Enum.with_index(1)
    |> Enum.map(fn {section, index} -> Map.put(section, :position, index) end)
    |> Enum.take(80)
  end

  defp clean_heading(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
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
      WHERE source_type = 'ncert'
        AND title = $1
        AND board = $2
        AND class_level = $3
        AND subject = $4
        AND chapter = $5
        AND topic = $6
      """,
      [
        metadata.title,
        metadata.board,
        metadata.class_level,
        metadata.subject,
        metadata.chapter,
        metadata.topic
      ]
    )
  end

  defp dump_uuid_or_nil(nil), do: nil
  defp dump_uuid_or_nil(value), do: Ecto.UUID.dump!(value)
end
