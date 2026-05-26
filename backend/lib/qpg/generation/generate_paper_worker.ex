defmodule Qpg.Generation.GeneratePaperWorker do
  use Oban.Worker, queue: :ai, max_attempts: 3

  alias Qpg.Generation
  alias Qpg.Logging

  @impl Oban.Worker
  def perform(%Oban.Job{id: job_id, attempt: attempt, args: %{"run_id" => run_id}}) do
    Logging.info("generation.worker.perform.started", %{
      job_id: job_id,
      attempt: attempt,
      run_id: run_id
    })

    Generation.perform_run(run_id)

    Logging.info("generation.worker.perform.completed", %{
      job_id: job_id,
      attempt: attempt,
      run_id: run_id
    })

    :ok
  rescue
    error ->
      Logging.error("generation.worker.perform.failed", %{
        job_id: job_id,
        attempt: attempt,
        run_id: run_id,
        error: Exception.message(error)
      })

      reraise error, __STACKTRACE__
  end
end
