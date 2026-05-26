defmodule Mix.Tasks.Qpg.IngestPyq do
  use Mix.Task

  @shortdoc "Imports processed PYQ text/PDF files into source_documents/source_chunks"

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    path = List.first(args) || "../data/pyq/processed"

    path
    |> Qpg.Sources.Cbse.PyqImport.ingest_path()
    |> Enum.each(fn result ->
      case result.status do
        :ok ->
          Mix.shell().info("Imported #{result.title}: #{result.chunks} chunks (#{result.note})")

        :error ->
          Mix.shell().error("Failed #{result.file}: #{result.reason}")
      end
    end)
  end
end
