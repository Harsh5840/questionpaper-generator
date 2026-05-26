import Config

config :qpg, QpgWeb.Endpoint,
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "dev-secret-key-base-change-me-for-production"

config :qpg, Qpg.AI.OpenAI,
  api_key: System.get_env("OPENAI_API_KEY"),
  model: System.get_env("OPENAI_MODEL", "gpt-5.1"),
  small_model: System.get_env("OPENAI_SMALL_MODEL", "gpt-5.1-mini"),
  large_model: System.get_env("OPENAI_LARGE_MODEL", "gpt-5.1")
