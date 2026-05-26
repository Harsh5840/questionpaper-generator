defmodule Qpg.AI.Provider do
  @moduledoc """
  Chooses the active AI provider while keeping the orchestration code provider-neutral.
  """

  alias Qpg.AI.Gemini
  alias Qpg.AI.OpenAI

  def active do
    case System.get_env("AI_PROVIDER", "gemini") |> String.downcase() do
      "openai" -> OpenAI
      "gemini" -> Gemini
      _ -> Gemini
    end
  end

  def enabled?, do: active().enabled?()
  def extract_request(prompt), do: active().extract_request(prompt)
  def generate_bundle(request), do: active().generate_bundle(request)
  def refine_bundle(paper, instruction), do: active().refine_bundle(paper, instruction)

  def extract_question_from_image(image_base64, mime_type, request),
    do: active().extract_question_from_image(image_base64, mime_type, request)
end
