defmodule Qpg.Repo.Migrations.SetChapterPositionsFromNcertCodes do
  use Ecto.Migration

  def up do
    execute("""
    WITH chapter_positions AS (
      SELECT
        sd.chapter_id,
        min(substring(sc.tags->>'file' from 'jemh1([0-9]{2})')::integer) AS position
      FROM source_documents sd
      JOIN source_chunks sc ON sc.source_document_id = sd.id
      WHERE sd.chapter_id IS NOT NULL
        AND lower(sd.source_type) = 'ncert'
        AND sc.tags->>'file' ~ '^jemh1[0-9]{2}'
      GROUP BY sd.chapter_id
    )
    UPDATE chapters c
    SET position = cp.position
    FROM chapter_positions cp
    WHERE cp.chapter_id = c.id
    """)
  end

  def down, do: :ok
end
