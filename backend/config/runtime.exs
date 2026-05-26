import Config

if config_env() == :prod do
  config :qpg, QpgWeb.Endpoint,
    secret_key_base: System.fetch_env!("SECRET_KEY_BASE"),
    url: [host: System.get_env("PHX_HOST", "localhost"), port: 443, scheme: "https"],
    http: [port: String.to_integer(System.get_env("PORT", "4000"))]

  config :qpg, Qpg.AI.OpenAI,
    api_key: System.get_env("OPENAI_API_KEY"),
    model: System.get_env("OPENAI_MODEL", "gpt-5.1")

  config :qpg, Qpg.AI.Gemini,
    api_key: System.get_env("GEMINI_API_KEY"),
    model: System.get_env("GEMINI_MODEL", "gemini-2.5-flash")
end
