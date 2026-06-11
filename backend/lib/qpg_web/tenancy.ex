defmodule QpgWeb.Tenancy do
  @moduledoc """
  Resolves the school's database-schema `prefix` for a request.

  The main product stores each school's data in its own Postgres schema, so every
  read/write must carry a `prefix:`. We read it from the `x-school-prefix` header
  (or a `prefix` query/body param); when absent the context falls back to `public`
  for standalone dev.
  """
  import Plug.Conn

  def prefix(conn) do
    case get_req_header(conn, "x-school-prefix") do
      [value | _] when is_binary(value) and value != "" -> value
      _ -> conn.params["prefix"]
    end
  end
end
