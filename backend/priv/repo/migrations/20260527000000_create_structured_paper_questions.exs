defmodule Qpg.Repo.Migrations.CreateStructuredPaperQuestions do
  use Ecto.Migration

  def change do
    create table(:paper_sections, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:paper_id, references(:papers, type: :uuid, on_delete: :delete_all), null: false)

      add(:paper_version_id, references(:paper_versions, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:section_key, :text)
      add(:position, :integer, null: false)
      add(:title, :text, null: false)
      add(:instructions, :text)
      add(:difficulty, :text)
      add(:target_marks, :integer)
      add(:payload, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(index(:paper_sections, [:paper_id, :paper_version_id]))
    create(unique_index(:paper_sections, [:paper_version_id, :position]))

    create table(:paper_questions, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:paper_id, references(:papers, type: :uuid, on_delete: :delete_all), null: false)

      add(:paper_version_id, references(:paper_versions, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:paper_section_id, references(:paper_sections, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:parent_question_id, references(:paper_questions, type: :uuid, on_delete: :delete_all))
      add(:question_key, :text)
      add(:position, :integer, null: false)
      add(:question_number, :text, null: false)
      add(:part_label, :text)
      add(:relation_type, :text, null: false, default: "root")
      add(:choice_group, :text)
      add(:question_type, :text)
      add(:marks, :integer, default: 0)
      add(:difficulty, :text)
      add(:source, :text)
      add(:topic, :text)
      add(:text, :text, null: false, default: "")
      add(:rich_text, :text)
      add(:answer, :text)
      add(:answer_rich_text, :text)
      add(:source_citations, {:array, :text}, default: [])
      add(:tags, {:array, :text}, default: [])
      add(:payload, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(index(:paper_questions, [:paper_id, :paper_version_id]))
    create(index(:paper_questions, [:paper_section_id, :position]))
    create(index(:paper_questions, [:parent_question_id]))
    create(index(:paper_questions, [:question_type, :marks, :difficulty]))

    create table(:paper_question_options, primary_key: false) do
      add(:id, :uuid, primary_key: true)

      add(:paper_question_id, references(:paper_questions, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:position, :integer, null: false)
      add(:label, :text)
      add(:text, :text, null: false, default: "")
      add(:rich_text, :text)
      add(:is_correct, :boolean, default: false)
      add(:payload, :map, default: %{})
      timestamps(type: :utc_datetime)
    end

    create(unique_index(:paper_question_options, [:paper_question_id, :position]))
  end
end
