defmodule Mix.Tasks.Qpg.ImportDumpCsv do
  @moduledoc """
  Imports the extracted textbook dump CSV folder into the dump-native corpus tables.

  Usage:

      mix qpg.import_dump_csv ../extracted_books_20260528/csv
      mix qpg.import_dump_csv ../extracted_books_20260528/csv --reset

  The dump keeps Gemini embeddings as PostgreSQL float arrays. This importer
  rewrites those values to pgvector literals so `chapter_chunks.embedding` stays
  searchable as `vector(3072)`.
  """

  use Mix.Task

  alias Ecto.Adapters.SQL
  alias Qpg.Repo

  NimbleCSV.define(QpgDumpCsv, separator: ",", escape: "\"")

  @shortdoc "Imports the extracted textbook dump CSV corpus"

  @dump_tables [
    "ingested_textbooks",
    "ingested_chapters",
    "ingested_subtopics",
    "book_index_entries",
    "master_index_lists",
    "master_index_entries",
    "chapter_chunks",
    "chapter_paragraph_keywords",
    "ingested_questions",
    "skills",
    "formulas",
    "ingested_formulas",
    "ingested_question_skills",
    "ingested_question_formulas",
    "question_book_index_links",
    "question_master_index_links",
    "ingested_chapter_reviews",
    "ingested_chapter_review_flags",
    "ingested_question_reviews",
    "pending_screenshot_questions"
  ]

  @self_refs %{
    "ingested_chapters" => ["parent_chapter_id"],
    "book_index_entries" => ["parent_id"],
    "master_index_entries" => ["parent_id"],
    "ingested_questions" => ["or_alternative_of_id"]
  }

  @types %{
    "id" => :uuid,
    "textbook_id" => :uuid,
    "chapter_id" => :uuid,
    "parent_chapter_id" => :uuid,
    "parent_id" => :uuid,
    "master_index_list_id" => :uuid,
    "book_index_entry_id" => :uuid,
    "master_index_entry_id" => :uuid,
    "question_id" => :uuid,
    "skill_id" => :uuid,
    "formula_id" => :uuid,
    "source_question_id" => :uuid,
    "or_alternative_of_id" => :uuid,
    "batch_id" => :uuid,
    "approved_question_id" => :uuid,
    "grade_levels" => :integer_array,
    "page_image_paths" => :varchar_array,
    "hints" => :text_array,
    "options" => :text_array,
    "key_formulas" => :text_array,
    "common_mistakes" => :text_array,
    "aliases" => :text_array,
    "topics" => :text_array,
    "related_formula_names" => :text_array,
    "keywords" => :jsonb,
    "concepts" => :jsonb,
    "definitions" => :jsonb,
    "book_ids" => :uuid_array,
    "source_textbook_ids" => :uuid_array,
    "source_book_entry_ids" => :uuid_array,
    "claimed_page_numbers" => :integer_array,
    "ingestion_metadata" => :jsonb,
    "markdown_store" => :jsonb,
    "extraction_store" => :jsonb,
    "paper_metadata" => :jsonb,
    "extraction_metadata" => :jsonb,
    "bifurcation_store" => :jsonb,
    "body_store" => :jsonb,
    "screenshot_store" => :jsonb,
    "raw_payload" => :jsonb,
    "edited_payload" => :jsonb,
    "embedding" => :vector,
    "auto_generated" => :boolean,
    "is_k12" => :boolean,
    "is_primary" => :boolean,
    "is_skippable" => :boolean,
    "confidence" => :float,
    "chapter_number" => :integer,
    "order_index" => :integer,
    "page_start" => :integer,
    "page_end" => :integer,
    "total_pages" => :integer,
    "page" => :integer,
    "paragraph_index" => :integer,
    "marks_possible" => :integer,
    "depth" => :integer,
    "set_number" => :integer,
    "page_number" => :integer,
    "order_in_batch" => :integer,
    "token_count" => :integer,
    "inserted_at" => :timestamp,
    "updated_at" => :timestamp,
    "approved_at" => :timestamp,
    "rejected_at" => :timestamp
  }

  @json_array_defaults MapSet.new(["keywords", "concepts", "definitions"])
  @json_object_defaults MapSet.new(["ingestion_metadata"])

  def run(args) do
    start_repo_only()

    {opts, positional, _invalid} = OptionParser.parse(args, strict: [reset: :boolean])
    csv_dir = positional |> List.first() |> Path.expand(File.cwd!())

    unless File.dir?(csv_dir) do
      Mix.raise("CSV folder not found: #{csv_dir}")
    end

    if opts[:reset], do: reset_dump_tables()

    expected_counts = expected_counts(csv_dir)

    @dump_tables
    |> Enum.each(fn table ->
      csv_path = Path.join(csv_dir, "#{table}.csv")

      if File.exists?(csv_path) do
        import_table(csv_path, table)
        update_self_refs(csv_path, table)
      else
        Mix.shell().info("Skipping #{table}: no CSV found")
      end
    end)

    validate_counts(expected_counts)
  end

  defp start_repo_only do
    Mix.Task.run("app.config")
    {:ok, _} = Application.ensure_all_started(:logger)
    {:ok, _} = Application.ensure_all_started(:postgrex)
    {:ok, _} = Application.ensure_all_started(:ecto_sql)
    {:ok, _} = Application.ensure_all_started(:pgvector)
    {:ok, _} = Application.ensure_all_started(:nimble_csv)

    case Process.whereis(Qpg.Repo) do
      nil -> {:ok, _pid} = Qpg.Repo.start_link()
      _pid -> :ok
    end
  end

  defp reset_dump_tables do
    Mix.shell().info("Resetting dump corpus tables before import")

    SQL.query!(
      Repo,
      """
      TRUNCATE
        pending_screenshot_questions,
        ingested_question_reviews,
        ingested_chapter_review_flags,
        ingested_chapter_reviews,
        question_master_index_links,
        question_book_index_links,
        ingested_question_formulas,
        ingested_question_skills,
        ingested_formulas,
        formulas,
        skills,
        ingested_questions,
        chapter_paragraph_keywords,
        chapter_chunks,
        master_index_entries,
        master_index_lists,
        book_index_entries,
        ingested_subtopics,
        ingested_chapters,
        ingested_textbooks
      RESTART IDENTITY
      CASCADE
      """,
      [],
      timeout: :infinity
    )
  end

  defp import_table(csv_path, table) do
    Mix.shell().info("Importing #{table}")

    {headers, rows} = read_csv(csv_path)
    self_ref_columns = Map.get(@self_refs, table, [])
    columns = headers
    batch_size = if table == "chapter_chunks", do: 12, else: 250

    rows
    |> Stream.map(fn values -> Enum.zip(columns, values) |> Map.new() end)
    |> Stream.chunk_every(batch_size)
    |> Enum.with_index(1)
    |> Enum.each(fn {batch, batch_number} ->
      batch =
        Enum.map(batch, fn row ->
          Enum.reduce(self_ref_columns, row, fn column, acc -> Map.put(acc, column, "") end)
        end)

      upsert_batch(table, columns, batch)

      if rem(batch_number, 20) == 0 do
        Mix.shell().info("  #{table}: imported #{batch_number * batch_size} rows...")
      end
    end)

    Mix.shell().info("Imported #{table}: #{length(rows)} CSV rows")
  end

  defp update_self_refs(csv_path, table) do
    columns = Map.get(@self_refs, table, [])

    if columns == [] do
      :ok
    else
      Mix.shell().info("Updating self references for #{table}")

      {headers, rows} = read_csv(csv_path)

      Enum.each(columns, fn column ->
        rows
        |> Stream.map(fn row -> Enum.zip(headers, row) |> Map.new() end)
        |> Stream.reject(&(blank?(&1[column]) or blank?(&1["id"])))
        |> Enum.each(fn row ->
          SQL.query!(
            Repo,
            "UPDATE #{table} SET #{column} = $1::uuid WHERE id = $2::uuid",
            [Ecto.UUID.dump!(row[column]), Ecto.UUID.dump!(row["id"])],
            timeout: :infinity
          )
        end)
      end)
    end
  end

  defp upsert_batch(_table, _columns, []), do: :ok

  defp upsert_batch(table, columns, rows) do
    values =
      rows
      |> Enum.with_index()
      |> Enum.map(fn {_row, row_index} ->
        placeholders =
          columns
          |> Enum.with_index()
          |> Enum.map(fn {column, column_index} ->
            "$#{row_index * length(columns) + column_index + 1}::#{sql_type(table, column)}"
          end)
          |> Enum.join(", ")

        "(#{placeholders})"
      end)
      |> Enum.join(", ")

    params =
      rows
      |> Enum.flat_map(fn row ->
        Enum.map(columns, fn column -> cast_value(row[column], table, column) end)
      end)

    updates =
      columns
      |> Enum.reject(&(&1 == "id"))
      |> Enum.map(&"#{&1} = EXCLUDED.#{&1}")
      |> Enum.join(", ")

    sql = """
    INSERT INTO #{table} (#{Enum.join(columns, ", ")})
    VALUES #{values}
    ON CONFLICT (id) DO UPDATE SET #{updates}
    """

    SQL.query!(Repo, sql, params, timeout: :infinity)
  end

  defp read_csv(path) do
    [header | rows] =
      path
      |> File.stream!([], :line)
      |> QpgDumpCsv.parse_stream(skip_headers: false)
      |> Enum.to_list()

    {header, rows}
  end

  defp cast_value(value, table, column) do
    type = type_for(table, column)

    cond do
      blank?(value) and type == :jsonb and MapSet.member?(@json_array_defaults, column) -> "[]"
      blank?(value) and type == :jsonb and MapSet.member?(@json_object_defaults, column) -> "{}"
      blank?(value) and type in [:text_array, :varchar_array, :uuid_array, :integer_array] -> []
      blank?(value) -> nil
      type == :uuid -> Ecto.UUID.dump!(value)
      type == :integer -> String.to_integer(value)
      type == :float -> parse_float(value)
      type == :boolean -> value in ["t", "true", "TRUE", "1"]
      type in [:text_array, :varchar_array] -> parse_pg_array(value)
      type == :integer_array -> value |> parse_pg_array() |> Enum.map(&String.to_integer/1)
      type == :uuid_array -> value |> parse_pg_array() |> Enum.map(&Ecto.UUID.dump!/1)
      type == :timestamp -> parse_timestamp(value)
      type == :vector -> vector_literal(value)
      true -> value
    end
  end

  defp sql_type(table, column) do
    case type_for(table, column) do
      :uuid -> "uuid"
      :integer -> "integer"
      :float -> "double precision"
      :boolean -> "boolean"
      :jsonb -> "jsonb"
      :text_array -> "text[]"
      :varchar_array -> "varchar[]"
      :uuid_array -> "uuid[]"
      :integer_array -> "integer[]"
      :vector -> "text::vector(3072)"
      :timestamp -> "timestamp(0) without time zone"
      _ -> "text"
    end
  end

  defp type_for("formulas", "keywords"), do: :text_array
  defp type_for("formulas", "common_mistakes"), do: :text
  defp type_for("chapter_paragraph_keywords", "keywords"), do: :jsonb
  defp type_for(_table, column), do: Map.get(@types, column, :text)

  defp vector_literal(value) do
    value
    |> String.trim()
    |> String.trim_leading("{")
    |> String.trim_trailing("}")
    |> then(&"[#{&1}]")
  end

  defp parse_timestamp(value) do
    value
    |> String.trim()
    |> String.replace(" ", "T", global: false)
    |> NaiveDateTime.from_iso8601!()
  end

  defp parse_float(value) do
    case Float.parse(value) do
      {number, ""} -> number
      {number, _rest} -> number
      :error -> value |> String.to_integer() |> Kernel.*(1.0)
    end
  end

  defp parse_pg_array(value) do
    value = String.trim(to_string(value))

    if value in ["", "{}"] do
      []
    else
      value
      |> String.trim_leading("{")
      |> String.trim_trailing("}")
      |> do_parse_pg_array([], "", false, false)
      |> Enum.reverse()
    end
  end

  defp do_parse_pg_array("", acc, current, _quoted, _escaped), do: [current | acc]

  defp do_parse_pg_array(<<char::utf8, rest::binary>>, acc, current, quoted, escaped) do
    cond do
      escaped ->
        do_parse_pg_array(rest, acc, current <> <<char::utf8>>, quoted, false)

      char == ?\\ ->
        do_parse_pg_array(rest, acc, current, quoted, true)

      char == ?" ->
        do_parse_pg_array(rest, acc, current, not quoted, false)

      char == ?, and not quoted ->
        do_parse_pg_array(rest, [current | acc], "", quoted, false)

      true ->
        do_parse_pg_array(rest, acc, current <> <<char::utf8>>, quoted, false)
    end
  end

  defp expected_counts(csv_dir) do
    counts_path =
      csv_dir
      |> Path.dirname()
      |> Path.join("table_counts.csv")

    if File.exists?(counts_path) do
      [_header | rows] =
        counts_path
        |> File.stream!([], :line)
        |> QpgDumpCsv.parse_stream(skip_headers: false)
        |> Enum.to_list()

      Map.new(rows, fn
        [schema, relation, rows] -> {{schema, relation}, String.to_integer(rows)}
        [relation, rows] -> {{"public", relation}, String.to_integer(rows)}
      end)
    else
      %{}
    end
  end

  defp validate_counts(expected_counts) do
    Mix.shell().info("Validating imported row counts")

    @dump_tables
    |> Enum.each(fn table ->
      expected = expected_counts[{"public", table}]
      actual = scalar("SELECT count(*) FROM #{table}")

      case expected do
        nil ->
          Mix.shell().info("  #{table}: #{actual} rows")

        ^actual ->
          Mix.shell().info("  #{table}: #{actual}/#{expected} rows")

        _ ->
          Mix.shell().error("  #{table}: #{actual}/#{expected} rows (mismatch)")
      end
    end)
  end

  defp scalar(sql) do
    case SQL.query!(Repo, sql, [], timeout: :infinity).rows do
      [[value]] -> value
      _ -> 0
    end
  end

  defp blank?(value), do: value in [nil, ""]
end
