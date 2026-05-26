defmodule QpgWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :qpg

  socket("/socket", QpgWeb.UserSocket,
    websocket: true,
    longpoll: false
  )

  plug(CORSPlug, origin: ["http://localhost:3000", "http://127.0.0.1:3000"])
  plug(Plug.RequestId)
  plug(Plug.Telemetry, event_prefix: [:phoenix, :endpoint])

  plug(Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Jason
  )

  plug(Plug.MethodOverride)
  plug(Plug.Head)
  plug(QpgWeb.Router)
end
