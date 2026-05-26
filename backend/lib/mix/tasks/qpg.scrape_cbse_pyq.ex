defmodule Mix.Tasks.Qpg.ScrapeCbsePyq do
  use Mix.Task

  @shortdoc "Downloads official CBSE PYQ PDFs into data/pyq/raw"

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    limit = parse_limit(args)

    max_size_mb = parse_max_size_mb(args)

    case Qpg.Sources.Cbse.PyqScraper.scrape(limit: limit, max_size_mb: max_size_mb) do
      {:ok, %{manifest: manifest, entries: entries}} ->
        Mix.shell().info("Wrote #{length(entries)} CBSE PYQ entries to #{Path.expand(manifest)}")

        Enum.each(entries, fn entry ->
          Mix.shell().info(
            "#{entry.status}: #{entry.subject} #{entry.year} -> #{Path.expand(entry.file)}"
          )
        end)

      {:error, reason} ->
        Mix.shell().error("CBSE PYQ scrape failed: #{reason}")
    end
  end

  defp parse_limit(args) do
    args
    |> Enum.find_value(fn arg ->
      case String.split(arg, "=", parts: 2) do
        ["--limit", value] -> String.to_integer(value)
        _ -> nil
      end
    end)
    |> Kernel.||(6)
  end

  defp parse_max_size_mb(args) do
    args
    |> Enum.find_value(fn arg ->
      case String.split(arg, "=", parts: 2) do
        ["--max-size-mb", value] -> String.to_integer(value)
        _ -> nil
      end
    end)
    |> Kernel.||(20)
  end
end
