defmodule Qpg.Repo.Migrations.RemoveLegacyDemoSourceRows do
  use Ecto.Migration

  def up do
    execute("""
    DELETE FROM source_documents
    WHERE source_type = 'NCERT'
      AND lower(board) = 'cbse'
      AND class_level = '10'
      AND lower(subject) = 'maths'
      AND lower(chapter) = 'algebra'
    """)

    execute("""
    DELETE FROM chapters c
    USING subjects s, school_classes sc, boards b
    WHERE c.subject_id = s.id
      AND s.school_class_id = sc.id
      AND sc.board_id = b.id
      AND lower(b.code) = 'cbse'
      AND sc.level = '10'
      AND lower(s.name) = 'maths'
      AND lower(c.name) = 'algebra'
      AND NOT EXISTS (
        SELECT 1 FROM source_documents sd WHERE sd.chapter_id = c.id
      )
    """)
  end

  def down, do: :ok
end
