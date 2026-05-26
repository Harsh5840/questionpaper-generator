defmodule Qpg.Repo.Migrations.BackfillCatalogFromSourceDocuments do
  use Ecto.Migration

  def up do
    execute("""
    INSERT INTO boards (id, code, name, inserted_at, updated_at)
    SELECT DISTINCT gen_random_uuid(), upper(trim(board)), upper(trim(board)), now(), now()
    FROM source_documents
    WHERE nullif(trim(board), '') IS NOT NULL
    ON CONFLICT (lower(code)) DO NOTHING
    """)

    execute("""
    INSERT INTO school_classes (id, board_id, level, name, inserted_at, updated_at)
    SELECT DISTINCT gen_random_uuid(), b.id, trim(sd.class_level), 'Class ' || trim(sd.class_level), now(), now()
    FROM source_documents sd
    JOIN boards b ON lower(b.code) = lower(trim(sd.board))
    WHERE nullif(trim(sd.class_level), '') IS NOT NULL
    ON CONFLICT (board_id, level) DO NOTHING
    """)

    execute("""
    INSERT INTO subjects (id, school_class_id, name, slug, inserted_at, updated_at)
    SELECT DISTINCT
      gen_random_uuid(),
      sc.id,
      trim(sd.subject),
      lower(regexp_replace(trim(sd.subject), '[^a-zA-Z0-9]+', '-', 'g')),
      now(),
      now()
    FROM source_documents sd
    JOIN boards b ON lower(b.code) = lower(trim(sd.board))
    JOIN school_classes sc ON sc.board_id = b.id AND sc.level = trim(sd.class_level)
    WHERE nullif(trim(sd.subject), '') IS NOT NULL
    ON CONFLICT (school_class_id, lower(name)) DO NOTHING
    """)

    execute("""
    INSERT INTO chapters (id, subject_id, name, slug, position, inserted_at, updated_at)
    SELECT DISTINCT ON (s.id, lower(trim(sd.chapter)))
      gen_random_uuid(),
      s.id,
      trim(sd.chapter),
      lower(regexp_replace(trim(sd.chapter), '[^a-zA-Z0-9]+', '-', 'g')),
      row_number() OVER (PARTITION BY s.id ORDER BY trim(sd.chapter)),
      now(),
      now()
    FROM source_documents sd
    JOIN boards b ON lower(b.code) = lower(trim(sd.board))
    JOIN school_classes sc ON sc.board_id = b.id AND sc.level = trim(sd.class_level)
    JOIN subjects s ON s.school_class_id = sc.id AND lower(s.name) = lower(trim(sd.subject))
    WHERE nullif(trim(sd.chapter), '') IS NOT NULL
      AND lower(trim(sd.chapter)) NOT IN ('prelims', 'appendix', 'answers part 1', 'answers part 2')
    ORDER BY s.id, lower(trim(sd.chapter)), trim(sd.chapter)
    ON CONFLICT (subject_id, lower(name)) DO NOTHING
    """)

    execute("""
    UPDATE source_documents sd
    SET chapter_id = c.id
    FROM boards b
    JOIN school_classes sc ON sc.board_id = b.id
    JOIN subjects s ON s.school_class_id = sc.id
    JOIN chapters c ON c.subject_id = s.id
    WHERE lower(b.code) = lower(trim(sd.board))
      AND sc.level = trim(sd.class_level)
      AND lower(s.name) = lower(trim(sd.subject))
      AND lower(c.name) = lower(trim(sd.chapter))
    """)
  end

  def down do
    execute("UPDATE source_documents SET chapter_id = NULL")
  end
end
