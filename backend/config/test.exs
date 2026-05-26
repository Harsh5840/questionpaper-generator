import Config

config :qpg, Qpg.Repo,
  database: "qpg_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox

config :qpg, QpgWeb.Endpoint,
  secret_key_base: "test-secret-key-base",
  server: false

config :qpg, Qpg.AI.OpenAI, api_key: nil, model: "mock"
