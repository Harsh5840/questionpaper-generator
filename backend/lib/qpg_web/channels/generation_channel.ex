defmodule QpgWeb.GenerationChannel do
  use Phoenix.Channel

  alias Qpg.Generation
  alias Qpg.Logging

  @impl true
  def join("generation:" <> run_id, _payload, socket) do
    run = Generation.get_run!(run_id)
    topic = "generation:#{run_id}"

    Phoenix.PubSub.subscribe(Qpg.PubSub, topic)

    Logging.info("channel.generation.joined", %{run_id: run_id, status: run.status})

    {:ok,
     %{
       event: "snapshot",
       message: message_for(run.status),
       progress: progress_for(run.status),
       step: run.status,
       run: Generation.serialize(run)
     }, assign(socket, :run_id, run_id)}
  end

  @impl true
  def handle_info({event, payload}, socket) do
    Logging.debug("channel.generation.push", %{
      run_id: socket.assigns[:run_id],
      event: event,
      step: payload[:step],
      progress: payload[:progress]
    })

    push(socket, event, payload)
    {:noreply, socket}
  end

  defp message_for("queued"), do: "Generation queued"
  defp message_for("running"), do: "Generation running"
  defp message_for("completed"), do: "Question papers ready"
  defp message_for("failed"), do: "Generation failed"
  defp message_for(_status), do: "Generation status updated"

  defp progress_for("queued"), do: 5
  defp progress_for("running"), do: 35
  defp progress_for("completed"), do: 100
  defp progress_for("failed"), do: 100
  defp progress_for(_status), do: 0
end
