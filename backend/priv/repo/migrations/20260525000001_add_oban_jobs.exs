defmodule Qpg.Repo.Migrations.AddObanJobs do
  use Ecto.Migration

  def up do
    Oban.Migration.up()
  end

  def down do
    Oban.Migration.down()
  end
end
