defmodule Qpg.Templates do
  alias Qpg.Logging
  alias Qpg.Repo
  alias Qpg.Templates.Template

  def list_templates do
    templates = Repo.all(Template)
    Logging.info("templates.list.completed", %{count: length(templates)})
    templates
  end

  def create_template(attrs) do
    Logging.info("templates.create.started", %{
      name: attrs["name"] || get_in(attrs, ["payload", "name"]),
      payload_keys: attrs |> Map.get("payload", %{}) |> Map.keys()
    })

    normalized = normalize_template(attrs)

    %Template{}
    |> Template.changeset(normalized)
    |> Repo.insert()
    |> tap(fn
      {:ok, template} ->
        Logging.info("templates.create.completed", %{
          template_id: template.id,
          name: template.name,
          formatting_keys: template.formatting |> Map.keys(),
          inferred_param_keys: template.inferred_params |> Map.keys()
        })

      {:error, changeset} ->
        Logging.error("templates.create.failed", %{errors: changeset.errors})
    end)
  end

  defp normalize_template(attrs) do
    payload = attrs["payload"] || %{}

    # Normalize both API-created templates and browser-uploaded payloads into
    # one shape so the generation pipeline can treat templates as optional
    # request/formatting evidence.
    %{
      "name" => attrs["name"] || payload["name"] || "Untitled template",
      "description" => attrs["description"] || payload["description"],
      "payload" => payload,
      "formatting" => attrs["formatting"] || payload["formatting"] || %{},
      "inferred_params" => attrs["inferred_params"] || payload["inferred_params"] || %{}
    }
  end
end
