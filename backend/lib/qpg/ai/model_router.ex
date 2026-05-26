defmodule Qpg.AI.ModelRouter do
  @moduledoc """
  Routes AI work to the smallest model class that can handle it.

  This mirrors the decision tree:
  parameter extraction/classification -> small/open-source,
  generation -> medium,
  small post-generation fixes -> small,
  whole rewrites -> medium/large.
  """

  def route(:parameter_extraction, _input) do
    %{
      use_case: :parameter_extraction,
      model_class: :small,
      model: "small-or-open-source-classifier"
    }
  end

  def route(:generation, request) do
    model_class =
      cond do
        (request["total_marks"] || 0) >= 100 -> :medium_large
        (request["variant_count"] || 1) > 5 -> :medium_large
        true -> :medium
      end

    %{use_case: :generation, model_class: model_class, model: model_name(model_class)}
  end

  def route(:post_generation_fix, instruction) do
    lower = String.downcase(instruction || "")

    if whole_rewrite?(lower) do
      %{use_case: :whole_rewrite, model_class: :medium_large, model: model_name(:medium_large)}
    else
      %{use_case: :small_fix, model_class: :small, model: model_name(:small)}
    end
  end

  defp whole_rewrite?(instruction) do
    Enum.any?(
      ["rewrite whole", "entire paper", "full rewrite", "regenerate all", "change everything"],
      &String.contains?(instruction, &1)
    )
  end

  defp model_name(:small),
    do: model_name_for_provider("SMALL", "gemini-2.5-flash", "gpt-5.1-mini")

  defp model_name(:medium), do: model_name_for_provider("", "gemini-2.5-flash", "gpt-5.1")

  defp model_name(:medium_large),
    do: model_name_for_provider("LARGE", "gemini-2.5-pro", "gpt-5.1")

  defp model_name_for_provider(size, gemini_default, openai_default) do
    case System.get_env("AI_PROVIDER", "gemini") |> String.downcase() do
      "openai" -> env_model("OPENAI", size, openai_default)
      _ -> env_model("GEMINI", size, gemini_default)
    end
  end

  defp env_model(prefix, "", default), do: System.get_env("#{prefix}_MODEL", default)
  defp env_model(prefix, size, default), do: System.get_env("#{prefix}_#{size}_MODEL", default)
end
