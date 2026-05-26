defmodule Qpg.Repo.Migrations.CreateV2RetrievalTables do
  use Ecto.Migration

  def change do
    create table(:concepts, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:board, :text, null: false)
      add(:class_level, :text, null: false)
      add(:subject, :text, null: false)
      add(:name, :text, null: false)
      add(:slug, :text, null: false)
      add(:description, :text)
      add(:metadata, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(
      unique_index(:concepts, [:board, :class_level, :subject, "lower(name)"],
        name: :concepts_scope_lower_name_index
      )
    )

    create table(:chapter_concepts, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:chapter_id, references(:chapters, type: :uuid, on_delete: :delete_all), null: false)
      add(:concept_id, references(:concepts, type: :uuid, on_delete: :delete_all), null: false)
      add(:weight, :float, default: 1.0)
      timestamps(type: :utc_datetime)
    end

    create(unique_index(:chapter_concepts, [:chapter_id, :concept_id]))

    create table(:pyq_questions, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:source_document_id, references(:source_documents, type: :uuid, on_delete: :nilify_all))
      add(:source_chunk_id, references(:source_chunks, type: :uuid, on_delete: :nilify_all))
      add(:board, :text)
      add(:class_level, :text)
      add(:subject, :text)
      add(:chapter, :text)
      add(:topic, :text)
      add(:year, :integer)
      add(:paper_code, :text)
      add(:series, :text)
      add(:section_label, :text)
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

    create(index(:pyq_questions, [:board, :class_level, :subject, :chapter, :topic]))
    create(index(:pyq_questions, [:question_type, :marks, :difficulty]))

    create table(:question_bank_items, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:board, :text)
      add(:class_level, :text)
      add(:subject, :text)
      add(:chapter, :text)
      add(:topic, :text)
      add(:question_type, :text)
      add(:marks, :integer)
      add(:difficulty, :text)
      add(:source, :text)
      add(:text, :text, null: false)
      add(:rich_text, :text)
      add(:answer, :text)
      add(:answer_rich_text, :text)
      add(:tags, {:array, :text}, default: [])
      add(:payload, :map, default: %{})
      add(:embedding, :vector, size: 1536)
      timestamps(type: :utc_datetime)
    end

    create(index(:question_bank_items, [:board, :class_level, :subject, :chapter, :topic]))
    create(index(:question_bank_items, [:question_type, :marks, :difficulty]))

    create table(:retrieval_runs, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:request, :map, null: false)
      add(:status, :text, null: false, default: "completed")
      add(:summary, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create table(:retrieval_results, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:retrieval_run_id, references(:retrieval_runs, type: :uuid, on_delete: :delete_all))
      add(:source_type, :text, null: false)
      add(:source_id, :text)
      add(:rank, :integer)
      add(:score, :float)
      add(:payload, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(index(:retrieval_results, [:retrieval_run_id]))

    create table(:ai_usage_events, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:generation_run_id, references(:generation_runs, type: :uuid, on_delete: :nilify_all))
      add(:paper_id, references(:papers, type: :uuid, on_delete: :nilify_all))
      add(:provider, :text, null: false, default: "gemini")
      add(:model, :text, null: false)
      add(:operation, :text, null: false)
      add(:input_tokens, :integer, default: 0)
      add(:output_tokens, :integer, default: 0)
      add(:total_tokens, :integer, default: 0)
      add(:estimated_cost_usd, :decimal, precision: 12, scale: 8, default: 0)
      add(:metadata, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(index(:ai_usage_events, [:generation_run_id]))
    create(index(:ai_usage_events, [:paper_id]))
    create(index(:ai_usage_events, [:model, :operation]))

    execute(
      "CREATE INDEX IF NOT EXISTS pyq_questions_embedding_idx ON pyq_questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)",
      "DROP INDEX IF EXISTS pyq_questions_embedding_idx"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS question_bank_items_embedding_idx ON question_bank_items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)",
      "DROP INDEX IF EXISTS question_bank_items_embedding_idx"
    )
  end
end
