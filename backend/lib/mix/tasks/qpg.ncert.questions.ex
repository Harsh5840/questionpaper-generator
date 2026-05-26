defmodule Mix.Tasks.Qpg.Ncert.Questions do
  use Mix.Task

  @shortdoc "Extracts importable NCERT example/exercise questions into ncert_questions rows"
  @requirements ["app.config"]

  @impl true
  def run(args) do
    Application.ensure_all_started(:logger)
    Application.ensure_all_started(:postgrex)
    Application.ensure_all_started(:ecto)
    Application.ensure_all_started(:ecto_sql)

    {:ok, _repo} = Qpg.Repo.start_link()

    opts = parse_args(args)
    summary = Qpg.Sources.Ncert.QuestionExtractor.retag_all(opts)

    Mix.shell().info("""
    Extracted NCERT questions:
      documents: #{summary.documents}
      inserted: #{summary.inserted}
      skipped: #{summary.skipped}
    """)
  end

  defp parse_args(args) do
    {opts, _rest, _invalid} =
      OptionParser.parse(args,
        switches: [board: :string, class_level: :string, subject: :string, chapter: :string],
        aliases: [b: :board, c: :class_level, s: :subject]
      )

    opts
  end
end
