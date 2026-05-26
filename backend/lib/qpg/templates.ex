defmodule Qpg.Templates do
  alias Qpg.Logging
  alias Qpg.Repo
  alias Qpg.Templates.Template

  def list_templates do
    templates = Repo.all(Template)
    Logging.info("templates.list.completed", %{count: length(templates)})
    templates
  end

  def ensure_builtin_templates do
    Logging.info("templates.ensure_builtin.started", %{count: length(builtin_templates())})

    builtin_templates()
    |> Enum.map(&upsert_builtin_template/1)
    |> tap(fn results ->
      Logging.info("templates.ensure_builtin.completed", %{
        inserted_or_updated: Enum.count(results, &match?({:ok, _}, &1)),
        failed: Enum.count(results, &match?({:error, _}, &1))
      })
    end)
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

  defp upsert_builtin_template(attrs) do
    normalized = normalize_template(attrs)

    case Repo.get_by(Template, name: normalized["name"]) do
      nil ->
        %Template{}
        |> Template.changeset(normalized)
        |> Repo.insert()

      template ->
        template
        |> Template.changeset(normalized)
        |> Repo.update()
    end
  end

  defp builtin_templates do
    [
      %{
        "name" => "Default",
        "description" => "Balanced CBSE-style paper with standard sectioning and clean printable spacing.",
        "payload" => %{
          "name" => "Default",
          "sections" => ["Section A", "Section B", "Section C", "Section D"],
          "instructions" => "Use a balanced board-style paper. Keep all questions compulsory unless the request asks for internal choice.",
          "layout_notes" => "Centered title, compact metadata line, section headers in uppercase, marks shown at the right of each question."
        },
        "formatting" => %{
          "margin" => 56,
          "lineHeight" => 1.55,
          "fontSize" => 16,
          "textColor" => "#111827",
          "accentColor" => "#895100",
          "pageColor" => "#ffffff"
        },
        "inferred_params" => %{
          "duration_minutes" => 120,
          "total_marks" => 50,
          "variant_count" => 3
        }
      },
      %{
        "name" => "Unit Test",
        "description" => "Short one-chapter assessment for quick classroom evaluation.",
        "payload" => %{
          "name" => "Unit Test",
          "sections" => ["Section A: Objective", "Section B: Short Answer", "Section C: Application"],
          "instructions" => "Focus on one chapter or a tight topic cluster. Prefer direct NCERT-grounded questions with a few application problems.",
          "layout_notes" => "Compact layout, smaller marks total, fewer sections, no answer key inline."
        },
        "formatting" => %{
          "margin" => 48,
          "lineHeight" => 1.45,
          "fontSize" => 15,
          "textColor" => "#111827",
          "accentColor" => "#006a61",
          "pageColor" => "#ffffff"
        },
        "inferred_params" => %{
          "chapter_scope" => "single",
          "duration_minutes" => 40,
          "total_marks" => 20,
          "variant_count" => 3,
          "question_types" => ["MCQ", "Short", "Long"]
        }
      },
      %{
        "name" => "Mid Term",
        "description" => "Moderate-length paper for multiple chapters with CBSE-like marks distribution.",
        "payload" => %{
          "name" => "Mid Term",
          "sections" => ["Section A: MCQ", "Section B: VSA", "Section C: SA", "Section D: LA"],
          "instructions" => "Distribute questions across selected chapters. Include a clear mix of conceptual, numerical, and reasoning questions.",
          "layout_notes" => "Use visible general instructions, section-wise marks, and optional internal choice only in longer sections."
        },
        "formatting" => %{
          "margin" => 56,
          "lineHeight" => 1.6,
          "fontSize" => 16,
          "textColor" => "#141b2b",
          "accentColor" => "#004ac6",
          "pageColor" => "#ffffff"
        },
        "inferred_params" => %{
          "chapter_scope" => "multiple",
          "duration_minutes" => 90,
          "total_marks" => 40,
          "variant_count" => 3,
          "question_types" => ["MCQ", "Short", "Long"]
        }
      },
      %{
        "name" => "Full Syllabus",
        "description" => "Full-length final exam template for whole-syllabus generation.",
        "payload" => %{
          "name" => "Full Syllabus",
          "sections" => ["Section A: MCQ", "Section B: Very Short Answer", "Section C: Short Answer", "Section D: Long Answer", "Section E: Case Study"],
          "instructions" => "Cover the full indexed syllabus with topic-wise balance. Use CBSE-style general instructions and include case-study questions where applicable.",
          "layout_notes" => "Board-exam style header, full general instructions, five sections, section-wise marks, answer key or marking scheme at the end."
        },
        "formatting" => %{
          "margin" => 60,
          "lineHeight" => 1.65,
          "fontSize" => 16,
          "textColor" => "#111827",
          "accentColor" => "#943700",
          "pageColor" => "#ffffff"
        },
        "inferred_params" => %{
          "chapter_scope" => "full_syllabus",
          "duration_minutes" => 180,
          "total_marks" => 80,
          "variant_count" => 3,
          "question_types" => ["MCQ", "Short", "Long", "Case Study"]
        }
      }
    ]
  end
end
