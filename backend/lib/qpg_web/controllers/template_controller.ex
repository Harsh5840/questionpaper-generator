defmodule QpgWeb.TemplateController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.Templates

  def index(conn, _params) do
    templates =
      Templates.list_templates()
      |> Enum.map(fn template ->
        %{
          id: template.id,
          name: template.name,
          description: template.description,
          payload: template.payload,
          formatting: template.formatting,
          inferred_params: template.inferred_params
        }
      end)

    Logging.info("api.templates.index.completed", %{count: length(templates)})
    json(conn, %{templates: templates})
  end

  def create(conn, params) do
    Logging.info("api.templates.create.received", %{
      name: params["name"] || get_in(params, ["payload", "name"]),
      payload_keys: params |> Map.get("payload", %{}) |> Map.keys()
    })

    case Templates.create_template(params) do
      {:ok, template} ->
        Logging.info("api.templates.create.completed", %{
          template_id: template.id,
          name: template.name
        })

        json(conn, %{
          id: template.id,
          name: template.name,
          description: template.description,
          payload: template.payload,
          formatting: template.formatting,
          inferred_params: template.inferred_params
        })

      {:error, changeset} ->
        Logging.error("api.templates.create.failed", %{errors: changeset.errors})

        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: inspect(changeset.errors)})
    end
  end
end
