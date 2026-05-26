defmodule Qpg.Repo.Migrations.CreateQuestionPaperGenerator do
  use Ecto.Migration

  def change do
    execute("CREATE EXTENSION IF NOT EXISTS vector", "DROP EXTENSION IF EXISTS vector")

    create table(:papers, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:title, :text, null: false)
      add(:board, :text, null: false)
      add(:class_level, :text, null: false)
      add(:subject, :text, null: false)
      add(:status, :text, null: false, default: "draft")
      add(:source_mode, :text)
      timestamps(type: :utc_datetime)
    end

    create table(:paper_versions, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:paper_id, references(:papers, type: :uuid, on_delete: :delete_all), null: false)
      add(:version_number, :integer, null: false)
      add(:change_source, :text, null: false)
      add(:payload, :map, null: false)
      add(:marks_total, :integer)
      timestamps(type: :utc_datetime)
    end

    create(unique_index(:paper_versions, [:paper_id, :version_number]))

    create table(:generation_runs, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:mode, :text, null: false)
      add(:request, :map, null: false)
      add(:status, :text, null: false)
      add(:variants, {:array, :map}, default: [])
      add(:warnings, {:array, :text}, default: [])
      add(:tool_trace, {:array, :map}, default: [])
      add(:paper_ids, {:array, :uuid}, default: [])
      timestamps(type: :utc_datetime)
    end

    create table(:source_documents, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:source_type, :text, null: false)
      add(:title, :text, null: false)
      add(:board, :text)
      add(:class_level, :text)
      add(:subject, :text)
      add(:chapter, :text)
      add(:topic, :text)
      timestamps(type: :utc_datetime)
    end

    create table(:source_chunks, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:source_document_id, references(:source_documents, type: :uuid, on_delete: :delete_all))
      add(:content, :text, null: false)
      add(:tags, :map, default: %{})
      add(:embedding, :vector, size: 1536)
      timestamps(type: :utc_datetime)
    end

    create(index(:source_documents, [:board, :class_level, :subject, :chapter, :topic]))

    create table(:exports, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:paper_id, references(:papers, type: :uuid, on_delete: :delete_all), null: false)
      add(:version_id, references(:paper_versions, type: :uuid, on_delete: :nilify_all))
      add(:format, :text, null: false)
      add(:status, :text, null: false)
      add(:file_url, :text)
      timestamps(type: :utc_datetime)
    end
  end
end
