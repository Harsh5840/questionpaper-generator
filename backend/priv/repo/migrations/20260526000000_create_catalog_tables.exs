defmodule Qpg.Repo.Migrations.CreateCatalogTables do
  use Ecto.Migration

  def change do
    execute("CREATE EXTENSION IF NOT EXISTS pgcrypto", "DROP EXTENSION IF EXISTS pgcrypto")

    create table(:boards, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:code, :text, null: false)
      add(:name, :text, null: false)
      timestamps(type: :utc_datetime)
    end

    create(unique_index(:boards, ["lower(code)"], name: :boards_lower_code_index))

    create table(:school_classes, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:board_id, references(:boards, type: :uuid, on_delete: :delete_all), null: false)
      add(:level, :text, null: false)
      add(:name, :text)
      timestamps(type: :utc_datetime)
    end

    create(unique_index(:school_classes, [:board_id, :level]))

    create table(:subjects, primary_key: false) do
      add(:id, :uuid, primary_key: true)

      add(:school_class_id, references(:school_classes, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:name, :text, null: false)
      add(:slug, :text, null: false)
      timestamps(type: :utc_datetime)
    end

    create(
      unique_index(:subjects, [:school_class_id, "lower(name)"],
        name: :subjects_class_lower_name_index
      )
    )

    create table(:chapters, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:subject_id, references(:subjects, type: :uuid, on_delete: :delete_all), null: false)
      add(:name, :text, null: false)
      add(:slug, :text, null: false)
      add(:position, :integer)
      timestamps(type: :utc_datetime)
    end

    create(
      unique_index(:chapters, [:subject_id, "lower(name)"],
        name: :chapters_subject_lower_name_index
      )
    )

    create table(:chapter_sections, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:chapter_id, references(:chapters, type: :uuid, on_delete: :delete_all), null: false)
      add(:name, :text, null: false)
      add(:section_type, :text)
      add(:position, :integer)
      add(:metadata, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(
      unique_index(:chapter_sections, [:chapter_id, "lower(name)"],
        name: :chapter_sections_chapter_lower_name_index
      )
    )

    alter table(:source_documents) do
      add(:chapter_id, references(:chapters, type: :uuid, on_delete: :nilify_all))
    end

    create(index(:source_documents, [:chapter_id]))

    execute(seed_catalog_from_source_documents_sql(), "")
  end

  defp seed_catalog_from_source_documents_sql do
    """
    WITH catalog_docs AS (
      SELECT DISTINCT
        nullif(trim(board), '') AS board,
        nullif(trim(class_level), '') AS class_level,
        nullif(trim(subject), '') AS subject,
        nullif(trim(chapter), '') AS chapter
      FROM source_documents
      WHERE nullif(trim(board), '') IS NOT NULL
        AND nullif(trim(class_level), '') IS NOT NULL
        AND nullif(trim(subject), '') IS NOT NULL
    ),
    inserted_boards AS (
      INSERT INTO boards (id, code, name, inserted_at, updated_at)
      SELECT gen_random_uuid(), upper(board), upper(board), now(), now()
      FROM catalog_docs
      ON CONFLICT (lower(code)) DO NOTHING
      RETURNING id
    ),
    inserted_classes AS (
      INSERT INTO school_classes (id, board_id, level, name, inserted_at, updated_at)
      SELECT gen_random_uuid(), b.id, d.class_level, 'Class ' || d.class_level, now(), now()
      FROM catalog_docs d
      JOIN boards b ON lower(b.code) = lower(d.board)
      ON CONFLICT (board_id, level) DO NOTHING
      RETURNING id
    ),
    inserted_subjects AS (
      INSERT INTO subjects (id, school_class_id, name, slug, inserted_at, updated_at)
      SELECT gen_random_uuid(), sc.id, d.subject, lower(regexp_replace(d.subject, '[^a-zA-Z0-9]+', '-', 'g')), now(), now()
      FROM catalog_docs d
      JOIN boards b ON lower(b.code) = lower(d.board)
      JOIN school_classes sc ON sc.board_id = b.id AND sc.level = d.class_level
      ON CONFLICT (school_class_id, lower(name)) DO NOTHING
      RETURNING id
    ),
    inserted_chapters AS (
      INSERT INTO chapters (id, subject_id, name, slug, position, inserted_at, updated_at)
      SELECT
        gen_random_uuid(),
        s.id,
        d.chapter,
        lower(regexp_replace(d.chapter, '[^a-zA-Z0-9]+', '-', 'g')),
        row_number() OVER (PARTITION BY s.id ORDER BY d.chapter),
        now(),
        now()
      FROM catalog_docs d
      JOIN boards b ON lower(b.code) = lower(d.board)
      JOIN school_classes sc ON sc.board_id = b.id AND sc.level = d.class_level
      JOIN subjects s ON s.school_class_id = sc.id AND lower(s.name) = lower(d.subject)
      WHERE d.chapter IS NOT NULL
        AND lower(d.chapter) NOT IN ('prelims', 'appendix', 'answers part 1', 'answers part 2')
      ON CONFLICT (subject_id, lower(name)) DO NOTHING
      RETURNING id
    )
    UPDATE source_documents sd
    SET chapter_id = c.id
    FROM boards b
    JOIN school_classes sc ON sc.board_id = b.id
    JOIN subjects s ON s.school_class_id = sc.id
    JOIN chapters c ON c.subject_id = s.id
    WHERE lower(b.code) = lower(sd.board)
      AND sc.level = sd.class_level
      AND lower(s.name) = lower(sd.subject)
      AND lower(c.name) = lower(sd.chapter);
    """
  end
end
