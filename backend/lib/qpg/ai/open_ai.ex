defmodule Qpg.AI.OpenAI do
  @moduledoc """
  OpenAI Responses API boundary for extraction, generation, refinement, and
  tool-calling. Provider errors are returned to the orchestrator and surfaced
  instead of being replaced with synthetic paper content.
  """

  alias Qpg.Logging
  alias Qpg.AI.Prompts
  alias Qpg.AI.Tools

  @endpoint "https://api.openai.com/v1/responses"

  def enabled? do
    api_key() not in [nil, ""]
  end

  def system_prompt, do: Prompts.system_prompt()
  def parameter_extraction_prompt, do: Prompts.parameter_extraction_prompt()
  def generation_prompt, do: Prompts.generation_prompt()
  def refinement_prompt, do: Prompts.refinement_prompt()
  def patch_prompt, do: Prompts.patch_prompt()

  def extract_question_from_image(_image_base64, _mime_type, _request),
    do: {:error, :image_question_import_only_implemented_for_gemini}

  def responses_tools do
    [
      tool_definition(
        "search_ncert",
        "Search owned NCERT chunks",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            board: %{type: "string"},
            class_level: %{type: "string"},
            subject: %{type: "string"},
            chapter: %{type: "string"},
            chapters: %{type: "array", items: %{type: "string"}},
            chapter_scope: %{type: "string"},
            topic: %{type: "string"},
            query: %{type: "string"},
            limit: %{type: "integer", minimum: 1, maximum: 12}
          },
          required: ["query", "limit"]
        }
      ),
      tool_definition(
        "search_pyq",
        "Search owned PYQ questions",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            board: %{type: "string"},
            class_level: %{type: "string"},
            subject: %{type: "string"},
            chapter: %{type: "string"},
            chapters: %{type: "array", items: %{type: "string"}},
            chapter_scope: %{type: "string"},
            topic: %{type: "string"},
            query: %{type: "string"},
            limit: %{type: "integer", minimum: 1, maximum: 12}
          },
          required: ["query", "limit"]
        }
      ),
      tool_definition(
        "get_marking_scheme",
        "Fetch board-specific marking scheme",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            board: %{type: "string"},
            class_level: %{type: "string"},
            subject: %{type: "string"},
            exam_type: %{type: "string"}
          },
          required: ["board", "class_level", "subject", "exam_type"]
        }
      ),
      tool_definition(
        "retrieve_template",
        "Extract missing params and formatting details from an optional user template",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            template: %{type: "object"}
          },
          required: ["template"]
        }
      ),
      tool_definition(
        "validate_paper",
        "Validate paper constraints",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            paper_json: %{type: "object"},
            target_constraints: %{type: "object"}
          },
          required: ["paper_json", "target_constraints"]
        }
      ),
      tool_definition(
        "rebalance_paper",
        "Rebalance marks and question types",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            paper_json: %{type: "object"},
            target_marks: %{type: "integer"},
            difficulty_mix: %{type: "string"},
            question_types: %{type: "array", items: %{type: "string"}}
          },
          required: ["paper_json", "target_marks", "question_types"]
        }
      ),
      tool_definition(
        "swap_question",
        "Swap one question without rewriting the full paper",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            paper_id: %{type: "string"},
            question_id: %{type: "string"},
            replacement_constraints: %{type: "object"}
          },
          required: ["paper_id", "question_id", "replacement_constraints"]
        }
      ),
      tool_definition(
        "format_paper",
        "Format paper for export",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            paper_json: %{type: "object"},
            template_id: %{type: "string"}
          },
          required: ["paper_json", "template_id"]
        }
      ),
      tool_definition(
        "generate_answer_key",
        "Generate answer key for a paper",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            paper_json: %{type: "object"},
            mode: %{type: "string"}
          },
          required: ["paper_json"]
        }
      ),
      tool_definition(
        "apply_paper_patch",
        "Apply accepted edits to a paper version",
        %{
          type: "object",
          additionalProperties: false,
          properties: %{
            paper_version_id: %{type: "string"},
            patch_ops: %{type: "array", items: %{type: "object"}}
          },
          required: ["paper_version_id", "patch_ops"]
        }
      )
    ]
  end

  def extract_request(prompt) when is_binary(prompt) do
    Logging.info("ai.openai.extract_request.received", %{prompt: prompt})
    if not enabled?(), do: {:error, :openai_disabled}, else: do_extract_request(prompt)
  end

  defp do_extract_request(prompt) do
    model = model_for(:small)
    Logging.info("ai.openai.extract_request.calling_model", %{model: model})

    response =
      responses_create(%{
        model: model,
        instructions: parameter_extraction_prompt(),
        input: [
          %{role: "developer", content: [%{type: "input_text", text: system_prompt()}]},
          %{role: "user", content: [%{type: "input_text", text: prompt}]}
        ],
        text: %{format: request_schema("paper_request", paper_request_schema())},
        tool_choice: "none",
        store: false
      })

    case response do
      {:ok, data} ->
        extracted = decode_structured_output(data)

        case extracted do
          %{"board" => _} ->
            Logging.info("ai.openai.extract_request.completed", %{keys: Map.keys(extracted)})
            {:ok, extracted}

          %{"class_level" => _} ->
            Logging.info("ai.openai.extract_request.completed", %{keys: Map.keys(extracted)})
            {:ok, extracted}

          _ ->
            Logging.error("ai.openai.extract_request.invalid_response", %{response: extracted})
            {:error, :invalid_extraction_response}
        end

      {:error, reason} ->
        Logging.error("ai.openai.extract_request.failed", %{reason: reason})
        {:error, reason}
    end
  end

  def generate_bundle(request) when is_map(request) do
    Logging.info("ai.openai.generate_bundle.received", %{request: request_summary(request)})
    if not enabled?(), do: {:error, :openai_disabled}, else: do_generate_bundle(request)
  end

  defp do_generate_bundle(request) do
    case generate(request) do
      {:ok, response} ->
        decoded = decode_structured_output(response)

        Logging.info("ai.openai.generate_bundle.completed", %{
          variant_count: decoded |> Map.get("variants", []) |> length(),
          warning_count: decoded |> Map.get("warnings", []) |> length()
        })

        {:ok, decoded}

      error ->
        Logging.error("ai.openai.generate_bundle.failed", %{error: error})
        error
    end
  end

  def refine_bundle(paper, instruction) do
    Logging.info("ai.openai.refine_bundle.received", %{
      paper_id: paper["id"] || paper[:id],
      instruction: instruction
    })

    if not enabled?(), do: {:error, :openai_disabled}, else: do_refine_bundle(paper, instruction)
  end

  defp do_refine_bundle(paper, instruction) do
    case refine(paper, instruction) do
      {:ok, response} ->
        decoded = decode_structured_output(response)

        Logging.info("ai.openai.refine_bundle.completed", %{
          patch_count: decoded |> Map.get("patch_ops", []) |> length()
        })

        {:ok, decoded}

      error ->
        Logging.error("ai.openai.refine_bundle.failed", %{error: error})
        error
    end
  end

  def generate(request) when is_map(request) do
    input = [
      %{role: "developer", content: [%{type: "input_text", text: system_prompt()}]},
      %{role: "developer", content: [%{type: "input_text", text: generation_prompt()}]},
      %{role: "user", content: [%{type: "input_text", text: Jason.encode!(request)}]}
    ]

    schema = request_schema("generation_result", generation_schema())
    model = model_for(:generation, request)

    Logging.info("ai.openai.generate.calling_model", %{
      model: model,
      request: request_summary(request)
    })

    responses_loop(%{
      model: model,
      instructions: generation_prompt(),
      input: input,
      tools: responses_tools(),
      tool_choice: "auto",
      text: %{format: schema},
      store: false
    })
  end

  def refine(paper, instruction) do
    input = [
      %{role: "developer", content: [%{type: "input_text", text: system_prompt()}]},
      %{role: "developer", content: [%{type: "input_text", text: refinement_prompt()}]},
      %{
        role: "user",
        content: [
          %{type: "input_text", text: Jason.encode!(%{paper: paper, instruction: instruction})}
        ]
      }
    ]

    schema = request_schema("refinement_result", refinement_schema())
    model = model_for(:post_generation_fix, instruction)

    Logging.info("ai.openai.refine.calling_model", %{model: model, instruction: instruction})

    responses_loop(%{
      model: model,
      instructions: refinement_prompt(),
      input: input,
      tools: responses_tools(),
      tool_choice: "auto",
      text: %{format: schema},
      store: false
    })
  end

  defp responses_loop(payload, tool_iterations \\ 0)

  defp responses_loop(_payload, tool_iterations) when tool_iterations > 4 do
    {:error, :too_many_tool_roundtrips}
  end

  defp responses_loop(payload, tool_iterations) do
    Logging.debug("ai.openai.responses_loop.iteration.started", %{
      model: payload[:model],
      iteration: tool_iterations,
      previous_response_id: payload[:previous_response_id]
    })

    case responses_create(payload) do
      {:ok, response} ->
        case function_calls(response) do
          [] ->
            Logging.debug("ai.openai.responses_loop.completed_without_tool_calls", %{
              model: payload[:model],
              iteration: tool_iterations,
              response_id: response["id"]
            })

            {:ok, response}

          calls ->
            Logging.info("ai.openai.responses_loop.tool_calls", %{
              model: payload[:model],
              iteration: tool_iterations,
              response_id: response["id"],
              tool_names: Enum.map(calls, & &1["name"])
            })

            tool_outputs =
              Enum.map(calls, fn call ->
                %{
                  type: "function_call_output",
                  call_id: call["call_id"],
                  output: Jason.encode!(execute_tool(call["name"], parse_args(call["arguments"])))
                }
              end)

            payload
            |> Map.put(:previous_response_id, response["id"])
            |> Map.put(:input, tool_outputs)
            |> responses_loop(tool_iterations + 1)
        end

      {:error, reason} ->
        Logging.error("ai.openai.responses_loop.failed", %{model: payload[:model], reason: reason})

        {:error, reason}
    end
  end

  defp execute_tool("search_ncert", args) do
    Logging.debug("ai.openai.tool.execute", %{name: "search_ncert", args: args})
    Tools.search_ncert(args, Map.get(args, "query"), Map.get(args, "limit", 6))
  end

  defp execute_tool("search_pyq", args) do
    Logging.debug("ai.openai.tool.execute", %{name: "search_pyq", args: args})
    Tools.search_pyq(args, Map.get(args, "query"), Map.get(args, "limit", 6))
  end

  defp execute_tool("get_marking_scheme", args) do
    Logging.debug("ai.openai.tool.execute", %{name: "get_marking_scheme", args: args})

    Tools.get_marking_scheme(
      args["board"],
      args["class_level"],
      args["subject"],
      args["exam_type"]
    )
  end

  defp execute_tool("retrieve_template", args) do
    Logging.debug("ai.openai.tool.execute", %{name: "retrieve_template", args: args})
    Tools.retrieve_template(args["template"])
  end

  defp execute_tool("validate_paper", args) do
    Logging.debug("ai.openai.tool.execute", %{name: "validate_paper", args: args})
    Tools.validate_paper(args["paper_json"], args["target_constraints"])
  end

  defp execute_tool("rebalance_paper", args) do
    Logging.debug("ai.openai.tool.execute", %{name: "rebalance_paper", args: args})

    Tools.rebalance_paper(
      args["paper_json"],
      args["target_marks"],
      args["difficulty_mix"],
      args["question_types"]
    )
  end

  defp execute_tool("swap_question", args) do
    %{tool: "swap_question", result: args}
  end

  defp execute_tool("format_paper", args) do
    %{tool: "format_paper", result: args}
  end

  defp execute_tool("generate_answer_key", args) do
    %{tool: "generate_answer_key", result: args}
  end

  defp execute_tool("apply_paper_patch", args) do
    %{tool: "apply_paper_patch", result: args}
  end

  defp execute_tool(name, args), do: %{tool: name, result: args}

  defp function_calls(response) do
    response
    |> Map.get("output", [])
    |> Enum.filter(&(&1["type"] == "function_call"))
  end

  defp decode_structured_output(%{"output_text" => text}) when is_binary(text) and text != "" do
    case Jason.decode(text) do
      {:ok, value} -> value
      _ -> %{"raw" => text}
    end
  end

  defp decode_structured_output(%{"output" => output} = response) when is_list(output) do
    output
    |> Enum.flat_map(&Map.get(&1, "content", []))
    |> Enum.find_value(fn
      %{"type" => "output_text", "text" => text} when is_binary(text) -> decode_json_or_raw(text)
      %{"type" => "text", "text" => text} when is_binary(text) -> decode_json_or_raw(text)
      _ -> nil
    end) || response
  end

  defp decode_structured_output(response), do: response

  defp decode_json_or_raw(text) when is_binary(text) do
    case Jason.decode(text) do
      {:ok, value} -> value
      _ -> %{"raw" => text}
    end
  end

  defp parse_args(args) when is_binary(args) do
    case Jason.decode(args) do
      {:ok, value} -> value
      _ -> %{}
    end
  end

  defp parse_args(args) when is_map(args), do: args
  defp parse_args(_), do: %{}

  defp responses_create(payload) do
    Logging.debug("ai.openai.http.request", %{
      model: payload[:model],
      has_tools: payload |> Map.get(:tools, []) |> Enum.any?(),
      previous_response_id: payload[:previous_response_id]
    })

    with {:ok, response} <- http_post(payload),
         {:ok, body} <- decode_body(response.body),
         200 <- response.status do
      Logging.debug("ai.openai.http.response.ok", %{
        model: payload[:model],
        status: response.status
      })

      {:ok, body}
    else
      {:ok, response} ->
        Logging.error("ai.openai.http.response.error_status", %{
          model: payload[:model],
          status: response.status,
          body: response.body
        })

        {:error, %{status: response.status, body: response.body}}

      {:error, reason} ->
        Logging.error("ai.openai.http.request.failed", %{
          model: payload[:model],
          reason: inspect(reason)
        })

        {:error, reason}

      status ->
        Logging.error("ai.openai.http.unexpected_result", %{
          model: payload[:model],
          status: status
        })

        {:error, status}
    end
  end

  defp http_post(payload) do
    request =
      Finch.build(
        :post,
        @endpoint,
        [
          {"authorization", "Bearer #{api_key()}"},
          {"content-type", "application/json"}
        ],
        Jason.encode!(payload)
      )

    Finch.request(request, Qpg.Finch)
  end

  defp decode_body(body) do
    case Jason.decode(body) do
      {:ok, json} -> {:ok, json}
      error -> error
    end
  end

  defp api_key,
    do: Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:api_key] || System.get_env("OPENAI_API_KEY")

  defp model_for(:small),
    do:
      Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:small_model] ||
        System.get_env("OPENAI_SMALL_MODEL", "gpt-5.1-mini")

  defp model_for(_),
    do:
      Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:model] ||
        System.get_env("OPENAI_MODEL", "gpt-5.1")

  defp model_for(:generation, request) do
    if Map.get(request, "total_marks", 0) >= 100 or Map.get(request, "variant_count", 1) > 5 do
      Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:large_model] ||
        System.get_env("OPENAI_LARGE_MODEL", "gpt-5.1")
    else
      Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:model] ||
        System.get_env("OPENAI_MODEL", "gpt-5.1")
    end
  end

  defp model_for(:post_generation_fix, instruction) do
    if whole_rewrite?(instruction) do
      Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:large_model] ||
        System.get_env("OPENAI_LARGE_MODEL", "gpt-5.1")
    else
      Application.get_env(:qpg, Qpg.AI.OpenAI, [])[:small_model] ||
        System.get_env("OPENAI_SMALL_MODEL", "gpt-5.1-mini")
    end
  end

  defp whole_rewrite?(instruction) do
    lower = String.downcase(instruction || "")

    Enum.any?(
      ["rewrite whole", "entire paper", "full rewrite", "regenerate all", "change everything"],
      &String.contains?(lower, &1)
    )
  end

  defp tool_definition(name, description, parameters) do
    %{type: "function", name: name, description: description, parameters: parameters}
  end

  defp request_summary(request) do
    Map.take(request, [
      "board",
      "class_level",
      "subject",
      "chapter_scope",
      "chapter",
      "chapters",
      "topic",
      "source",
      "difficulty",
      "total_marks",
      "duration_minutes",
      "variant_count"
    ])
  end

  defp request_schema(name, schema) do
    %{type: "json_schema", name: name, strict: true, schema: schema}
  end

  defp paper_request_schema do
    %{
      type: "object",
      additionalProperties: false,
      properties: %{
        board: %{type: ["string", "null"]},
        class_level: %{type: ["string", "null"]},
        subject: %{type: ["string", "null"]},
        chapter: %{type: ["string", "null"]},
        chapter_scope: %{type: ["string", "null"]},
        chapters: %{type: "array", items: %{type: "string"}},
        topic: %{type: ["string", "null"]},
        source: %{type: ["string", "null"]},
        question_types: %{type: "array", items: %{type: "string"}},
        marking_scheme: %{type: ["string", "null"]},
        difficulty: %{type: ["string", "null"]},
        total_marks: %{type: ["integer", "null"]},
        duration_minutes: %{type: ["integer", "null"]},
        variant_count: %{type: ["integer", "null"]}
      },
      required: [
        "board",
        "class_level",
        "subject",
        "chapter",
        "chapter_scope",
        "chapters",
        "topic",
        "source",
        "question_types",
        "marking_scheme",
        "difficulty",
        "total_marks",
        "duration_minutes",
        "variant_count"
      ]
    }
  end

  defp generation_schema do
    %{
      type: "object",
      additionalProperties: false,
      properties: %{
        variants: %{
          type: "array",
          items: paper_schema()
        },
        warnings: %{type: "array", items: %{type: "string"}},
        tool_trace: %{
          type: "array",
          items: %{
            type: "object",
            additionalProperties: false,
            properties: %{
              tool: %{type: "string"},
              summary: %{type: "string"},
              count: %{type: "integer"}
            },
            required: ["tool", "summary", "count"]
          }
        }
      },
      required: ["variants", "warnings", "tool_trace"]
    }
  end

  defp refinement_schema do
    %{
      type: "object",
      additionalProperties: false,
      properties: %{
        message: %{type: "string"},
        base_version_id: %{type: "string"},
        patch_ops: %{
          type: "array",
          items: %{
            type: "object",
            additionalProperties: false,
            properties: %{
              op: %{type: "string"},
              path: %{type: "string"},
              value: %{type: "string"}
            },
            required: ["op", "path", "value"]
          }
        },
        preview: paper_schema()
      },
      required: ["message", "base_version_id", "patch_ops", "preview"]
    }
  end

  defp paper_schema do
    %{
      type: "object",
      additionalProperties: false,
      properties: %{
        id: %{type: "string"},
        title: %{type: "string"},
        metadata: %{
          type: "object",
          additionalProperties: false,
          properties: %{
            board: %{type: "string"},
            class_level: %{type: "string"},
            subject: %{type: "string"},
            chapter: %{type: ["string", "null"]},
            topic: %{type: ["string", "null"]},
            duration_minutes: %{type: "integer"},
            source: %{type: "string"}
          },
          required: [
            "board",
            "class_level",
            "subject",
            "chapter",
            "topic",
            "duration_minutes",
            "source"
          ]
        },
        summary: %{
          type: "object",
          additionalProperties: false,
          properties: %{
            total_marks: %{type: "integer"},
            question_count: %{type: "integer"},
            difficulty: %{type: "string"},
            source_coverage: %{type: "string"},
            model_route: %{type: ["string", "null"]}
          },
          required: [
            "total_marks",
            "question_count",
            "difficulty",
            "source_coverage",
            "model_route"
          ]
        },
        sections: %{
          type: "array",
          items: %{
            type: "object",
            additionalProperties: false,
            properties: %{
              id: %{type: "string"},
              title: %{type: "string"},
              instructions: %{type: "string"},
              questions: %{
                type: "array",
                items: %{
                  type: "object",
                  additionalProperties: false,
                  properties: %{
                    id: %{type: "string"},
                    text: %{type: "string"},
                    marks: %{type: "integer"},
                    type: %{type: "string"},
                    difficulty: %{type: "string"},
                    source: %{type: "string"},
                    answer: %{type: "string"}
                  },
                  required: ["id", "text", "marks", "type", "difficulty", "source", "answer"]
                }
              }
            },
            required: ["id", "title", "instructions", "questions"]
          }
        },
        warnings: %{type: "array", items: %{type: "string"}}
      },
      required: ["id", "title", "metadata", "summary", "sections", "warnings"]
    }
  end
end
