defmodule Qpg.Templates.Template do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, Ecto.UUID, autogenerate: true}
  @foreign_key_type Ecto.UUID

  schema "templates" do
    field(:name, :string)
    field(:description, :string)
    field(:payload, :map)
    field(:formatting, :map)
    field(:inferred_params, :map)
    timestamps(type: :utc_datetime)
  end

  def changeset(template, attrs) do
    template
    |> cast(attrs, [:name, :description, :payload, :formatting, :inferred_params])
    |> validate_required([:name, :payload])
  end
end
