defmodule Qpg.Repo.Migrations.CreateNcertQuestions do
  use Ecto.Migration

  def change do
    create table(:ncert_questions, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:source_document_id, references(:source_documents, type: :uuid, on_delete: :delete_all))
      add(:chapter_id, references(:chapters, type: :uuid, on_delete: :nilify_all))
      add(:board, :text)
      add(:class_level, :text)
      add(:subject, :text)
      add(:chapter, :text)
      add(:topic, :text)
      add(:section_label, :text)
      add(:section_type, :text)
      add(:question_number, :integer)
      add(:question_type, :text)
      add(:marks, :integer)
      add(:difficulty, :text)
      add(:text, :text, null: false)
      add(:answer, :text)
      add(:tags, :map, default: %{})
      add(:embedding, :vector, size: 1536)
      timestamps(type: :utc_datetime)
    end

    create(index(:ncert_questions, [:board, :class_level, :subject, :chapter, :topic]))
    create(index(:ncert_questions, [:chapter_id, :section_label]))
    create(index(:ncert_questions, [:question_type, :marks, :difficulty]))

    execute(
      "CREATE INDEX IF NOT EXISTS ncert_questions_embedding_idx ON ncert_questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)",
      "DROP INDEX IF EXISTS ncert_questions_embedding_idx"
    )
  end
end
