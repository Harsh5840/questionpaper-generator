defmodule Mix.Tasks.Qpg.IngestNcert do
  use Mix.Task

  @shortdoc "Imports owned NCERT files into source_documents/source_chunks"

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    path = List.first(args) || "../data/ncert/raw"
    results = Qpg.Sources.ingest_ncert_path(path)

    if results == [] do
      Mix.shell().info("No supported NCERT files found at #{Path.expand(path)}")
    else
      Enum.each(results, &print_result/1)
    end
  end

  defp print_result(%{status: :ok} = result) do
    Mix.shell().info(
      "Imported #{result.title}: #{result.chunks} chunks from #{result.file} (#{result.note})"
    )
  end

  defp print_result(%{status: :error} = result) do
    Mix.shell().error("Skipped #{result.file}: #{result.reason}")
  end
end
