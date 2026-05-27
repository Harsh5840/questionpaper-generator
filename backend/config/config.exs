import Config

env_path = Path.expand("../../.env", __DIR__)

if File.exists?(env_path) do
  env_path
  |> File.stream!()
  |> Stream.map(&String.trim/1)
  |> Stream.reject(&(&1 == "" or String.starts_with?(&1, "#") or not String.contains?(&1, "=")))
  |> Enum.each(fn line ->
    [key, value] = String.split(line, "=", parts: 2)
    key = String.trim(key)

    if System.get_env(key) in [nil, ""] do
      System.put_env(key, String.trim(value))
    end
  end)
end

config :qpg,
  ecto_repos: [Qpg.Repo],
  generators: [timestamp_type: :utc_datetime]

config :qpg, Qpg.Repo,
  database: System.get_env("POSTGRES_DB", "qpg_dev"),
  username: System.get_env("POSTGRES_USER", "postgres"),
  password: System.get_env("POSTGRES_PASSWORD", "postgres"),
  hostname: System.get_env("POSTGRES_HOST", "localhost"),
  pool_size: 10

config :qpg, QpgWeb.Endpoint,
  url: [host: "localhost"],
  http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
  check_origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  render_errors: [formats: [json: QpgWeb.ErrorJSON], layout: false],
  pubsub_server: Qpg.PubSub,
  server: true

config :qpg, Oban,
  repo: Qpg.Repo,
  queues: [default: 10, ai: 5, exports: 5, ingestion: 5],
  plugins: [Oban.Plugins.Pruner]

config :logger, :console, format: "$time $metadata[$level] $message\n"

import_config "#{config_env()}.exs"
