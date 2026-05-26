defmodule Qpg.MixProject do
  use Mix.Project

  def project do
    [
      app: :qpg,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      mod: {Qpg.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:phoenix, "~> 1.7.21"},
      {:phoenix_ecto, "~> 4.6"},
      {:ecto_sql, "~> 3.12"},
      {:postgrex, ">= 0.0.0"},
      {:pgvector, "~> 0.3"},
      {:oban, "~> 2.19"},
      {:finch, "~> 0.19"},
      {:jason, "~> 1.4"},
      {:plug_cowboy, "~> 2.7"},
      {:cors_plug, "~> 3.0"}
    ]
  end
end
