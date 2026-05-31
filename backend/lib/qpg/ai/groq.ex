defmodule Qpg.AI.Groq do
  @moduledoc """
  Groq OpenAI-compatible chat boundary.

  Groq is kept config-driven and intentionally simple: model names and pricing
  come from env vars, while the existing orchestration layer still owns
  retrieval, validation, source-mix enforcement, and versioning.
  """

  alias Qpg.AI.Prompts
  alias Qpg.AI.Usage
  alias Qpg.Logging

  @endpoint "https://api.groq.com/openai/v1/chat/completions"

  def enabled?, do: api_key() not in [nil, ""]

  def extract_request(prompt) when is_binary(prompt) do
    Logging.info("ai.groq.extract_request.received", %{prompt: prompt})

    if enabled?() do
      model = model_for(:small)

      chat_json(model, [
        system_message(Prompts.system_prompt()),
        user_message("""
        #{Prompts.parameter_extraction_prompt()}

        Return JSON only.

        User prompt:
        #{prompt}
        """)
      ])
    else
      {:error, :groq_disabled}
    end
  end

  def generate_bundle(request) when is_map(request) do
    Logging.info("ai.groq.generate_bundle.received", %{request: request_summary(request)})

    if enabled?() do
      model = model_for(:generation, request)

      chat_json(model, [
        system_message(Prompts.system_prompt()),
        user_message("""
        #{Prompts.generation_prompt()}

        Return JSON only. Do not wrap the response in Markdown.

        Normalized PaperRequest JSON:
        #{Jason.encode!(request)}
        """)
      ])
    else
      {:error, :groq_disabled}
    end
  end

  def refine_bundle(paper, instruction) do
    Logging.info("ai.groq.refine_bundle.received", %{
      paper_id: paper["id"] || paper[:id],
      instruction: instruction
    })

    if enabled?() do
      model = model_for(:post_generation_fix, instruction)

      chat_json(model, [
        system_message(Prompts.system_prompt()),
        user_message("""
        #{Prompts.refinement_prompt()}

        Return JSON only with message, patch_ops, and preview.

        Instruction:
        #{instruction}

        Paper JSON:
        #{Jason.encode!(paper)}
        """)
      ])
    else
      {:error, :groq_disabled}
    end
  end

  def extract_question_from_image(_image_base64, _mime_type, _request),
    do: {:error, :image_question_import_only_implemented_for_gemini}

  defp chat_json(model, messages) do
    payload = %{
      model: model,
      messages: messages,
      temperature: 0.35,
      response_format: %{type: "json_object"}
    }

    with {:ok, response} <- request_chat(model, payload),
         {:ok, text} <- response_text(response),
         {:ok, json} <- decode_json(text) do
      {:ok, json}
    end
  end

  defp request_chat(model, payload, attempts_left \\ 3) do
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

    started_at = System.monotonic_time(:millisecond)

    with {:ok, %{status: 200} = response} <- Finch.request(request, Qpg.Finch, receive_timeout: 180_000),
         {:ok, body} <- Jason.decode(response.body) do
      Process.put(:qpg_ai_latency_ms, System.monotonic_time(:millisecond) - started_at)
      Usage.record_event("groq", model, Map.get(body, "usage", %{}))
      Process.delete(:qpg_ai_latency_ms)
      {:ok, body}
    else
      {:ok, response} ->
        Logging.error("ai.groq.http.response.error_status", %{
          model: model,
          status: response.status,
          body: decode_body(response.body)
        })

        {:error, %{status: response.status, body: decode_body(response.body)}}

      {:error, reason} when attempts_left > 0 ->
        Logging.warning("ai.groq.http.request.retrying", %{
          model: model,
          reason: inspect(reason),
          attempts_left: attempts_left
        })

        Process.sleep((4 - attempts_left) * 750)
        request_chat(model, payload, attempts_left - 1)

      {:error, reason} ->
        Logging.error("ai.groq.http.request.failed", %{model: model, reason: inspect(reason)})
        {:error, reason}
    end
  end

  defp response_text(%{"choices" => [%{"message" => %{"content" => content}} | _]}) when is_binary(content),
    do: {:ok, content}

  defp response_text(response) do
    Logging.error("ai.groq.response.missing_content", %{response: response})
    {:error, :missing_groq_content}
  end

  defp decode_json(text) do
    text
    |> String.trim()
    |> String.trim_leading("```json")
    |> String.trim_leading("```")
    |> String.trim_trailing("```")
    |> String.trim()
    |> Jason.decode()
  end

  defp system_message(content), do: %{role: "system", content: content}
  defp user_message(content), do: %{role: "user", content: content}

  defp api_key, do: System.get_env("GROQ_API_KEY")

  defp model_for(:small), do: System.get_env("GROQ_SMALL_MODEL", System.get_env("GROQ_MODEL", ""))
  defp model_for(:generation, _request), do: System.get_env("GROQ_MODEL", System.get_env("GROQ_SMALL_MODEL", ""))

  defp model_for(:post_generation_fix, instruction) do
    lower = String.downcase(instruction || "")

    if Enum.any?(["whole", "entire", "rewrite"], &String.contains?(lower, &1)) do
      System.get_env("GROQ_LARGE_MODEL", System.get_env("GROQ_MODEL", ""))
    else
      System.get_env("GROQ_SMALL_MODEL", System.get_env("GROQ_MODEL", ""))
    end
  end

  defp request_summary(request) do
    Map.take(request, [
      "board",
      "class_level",
      "subject",
      "chapter_scope",
      "chapters",
      "source",
      "difficulty",
      "total_marks",
      "variant_count"
    ])
  end

  defp decode_body(body) do
    case Jason.decode(body) do
      {:ok, decoded} -> decoded
      _ -> body
    end
  end
end
