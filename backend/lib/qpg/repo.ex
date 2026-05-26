defmodule Qpg.Repo do
  use Ecto.Repo,
    otp_app: :qpg,
    adapter: Ecto.Adapters.Postgres
end
