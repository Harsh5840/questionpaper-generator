defmodule Qpg.Repo.Migrations.CreateTemplates do
  use Ecto.Migration

  def change do
    create table(:templates, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:name, :text, null: false)
      add(:description, :text)
      add(:payload, :map, null: false)
      add(:formatting, :map, default: %{})
      add(:inferred_params, :map, default: %{})
      timestamps(type: :utc_datetime)
    end
  end
end
