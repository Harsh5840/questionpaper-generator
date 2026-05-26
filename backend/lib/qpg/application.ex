defmodule Qpg.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Qpg.Repo,
      {Phoenix.PubSub, name: Qpg.PubSub},
      {Finch, name: Qpg.Finch},
      {Oban, Application.fetch_env!(:qpg, Oban)},
      QpgWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Qpg.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    QpgWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
