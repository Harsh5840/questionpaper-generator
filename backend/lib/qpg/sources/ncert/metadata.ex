defmodule Qpg.Sources.Ncert.Metadata do
  @moduledoc """
  Derives source metadata from NCERT file paths and official file codes.
  """

  @class_10_maths %{
    "jemh101" => "Real Numbers",
    "jemh102" => "Polynomials",
    "jemh103" => "Pair Of Linear Equations In Two Variables",
    "jemh104" => "Quadratic Equations",
    "jemh105" => "Arithmetic Progressions",
    "jemh106" => "Triangles",
    "jemh107" => "Coordinate Geometry",
    "jemh108" => "Introduction To Trigonometry",
    "jemh109" => "Some Applications Of Trigonometry",
    "jemh110" => "Circles",
    "jemh111" => "Areas Related To Circles",
    "jemh112" => "Surface Areas And Volumes",
    "jemh113" => "Statistics",
    "jemh114" => "Probability",
    "jemh1a1" => "Answers Part 1",
    "jemh1a2" => "Answers Part 2",
    "jemh1an" => "Appendix",
    "jemh1ps" => "Prelims"
  }

  @class_10_science %{
    "jesc101" => "Chemical Reactions And Equations",
    "jesc102" => "Acids Bases And Salts",
    "jesc103" => "Metals And Non-Metals",
    "jesc104" => "Carbon And Its Compounds",
    "jesc105" => "Life Processes",
    "jesc106" => "Control And Coordination",
    "jesc107" => "How Do Organisms Reproduce",
    "jesc108" => "Heredity",
    "jesc109" => "Light Reflection And Refraction",
    "jesc110" => "The Human Eye And The Colourful World",
    "jesc111" => "Electricity",
    "jesc112" => "Magnetic Effects Of Electric Current",
    "jesc113" => "Our Environment",
    "jesc114" => "Sources Of Energy",
    "jesc115" => "Management Of Natural Resources",
    "jesc1an" => "Appendix",
    "jesc1ps" => "Prelims"
  }

  def from_path(path) do
    parts = path |> Path.expand() |> Path.split() |> Enum.map(&slug_to_title/1)
    lowered = Enum.map(parts, &String.downcase/1)
    file_code = path |> Path.rootname() |> Path.basename() |> String.downcase()
    title = official_title(file_code)

    %{
      title: title,
      board: detect_one(lowered, ["cbse", "icse"], "CBSE"),
      class_level: detect_class_level(lowered),
      subject: detect_one(lowered, ["maths", "science", "physics", "chemistry", "biology"], "Maths"),
      chapter: title,
      topic: title
    }
  end

  defp official_title(file_code) do
    Map.get(@class_10_maths, file_code) ||
      Map.get(@class_10_science, file_code) ||
      slug_to_title(file_code)
  end

  defp detect_class_level(parts) do
    Enum.find_value(parts, "10", fn part ->
      case Regex.run(~r/class\s*[-_]?\s*(9|10|11|12)/i, part) do
        [_, class] -> class
        _ -> nil
      end
    end)
  end

  defp detect_one(parts, candidates, default) do
    match = Enum.find(candidates, fn candidate -> candidate in parts end)

    case match do
      nil -> default
      "cbse" -> "CBSE"
      "icse" -> "ICSE"
      "maths" -> "Maths"
      "science" -> "Science"
      other -> String.capitalize(other)
    end
  end

  defp slug_to_title(value) do
    value
    |> Path.basename()
    |> String.replace(~r/\.[^.]+$/, "")
    |> String.replace(~r/[-_]+/, " ")
    |> String.trim()
    |> String.split(~r/\s+/, trim: true)
    |> Enum.map_join(" ", &String.capitalize/1)
  end
end
