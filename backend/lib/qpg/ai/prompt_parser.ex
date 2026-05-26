defmodule Qpg.AI.PromptParser do
  @subjects ["maths", "physics", "chemistry", "biology"]

  def parse(prompt) do
    text = String.downcase(prompt)

    %{}
    |> maybe_put("board", board(text))
    |> maybe_put("class_level", capture(text, ~r/class\s*(9|10|11|12)/))
    |> maybe_put("subject", subject(text))
    |> maybe_put("total_marks", marks(text))
    |> maybe_put("difficulty", difficulty(text))
    |> maybe_put("source", source(text))
    |> maybe_put("topic", topic(prompt))
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp board(text) do
    cond do
      String.contains?(text, "icse") -> "ICSE"
      String.contains?(text, "cbse") -> "CBSE"
      true -> nil
    end
  end

  defp subject(text) do
    Enum.find_value(@subjects, fn subject ->
      if String.contains?(text, subject), do: String.capitalize(subject)
    end)
  end

  defp marks(text) do
    case Regex.run(~r/(\d+)\s*(mark|marks)/, text) do
      [_, value, _] -> String.to_integer(value)
      _ -> nil
    end
  end

  defp difficulty(text) do
    cond do
      String.contains?(text, "hard") or String.contains?(text, "difficult") -> "Hard"
      String.contains?(text, "easy") -> "Easy"
      String.contains?(text, "medium") -> "Medium"
      true -> nil
    end
  end

  defp source(text) do
    cond do
      String.contains?(text, "pyq") and String.contains?(text, "ncert") -> "NCERT + PYQ"
      String.contains?(text, "pyq") -> "PYQ"
      String.contains?(text, "ncert") -> "NCERT"
      true -> nil
    end
  end

  defp topic(prompt) do
    case Regex.run(~r/from\s+(.+?)(?:\s+with|\s+for|\s+\d+\s*marks|$)/i, prompt) do
      [_, value] -> String.trim(value)
      _ -> nil
    end
  end

  defp capture(text, regex) do
    case Regex.run(regex, text) do
      [_, value] -> value
      _ -> nil
    end
  end
end
