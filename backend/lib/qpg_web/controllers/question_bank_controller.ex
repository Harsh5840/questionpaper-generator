defmodule QpgWeb.QuestionBankController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging
  alias Qpg.QuestionBank

  def index(conn, params) do
    items = QuestionBank.list_items(params)

    Logging.info("api.question_bank.index.completed", %{count: length(items)})

    json(conn, %{items: Enum.map(items, &serialize/1)})
  end

  def create(conn, params) do
    Logging.info("api.question_bank.create.received", %{
      board: params["board"],
      class_level: params["class_level"],
      subject: params["subject"],
      marks: params["marks"],
      difficulty: params["difficulty"]
    })

    case QuestionBank.create_item(params) do
      {:ok, item} ->
        conn |> put_status(:created) |> json(serialize(item))

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(changeset.errors)})
    end
  end

  defp serialize(item) do
    %{
      id: item.id,
      board: item.board,
      class_level: item.class_level,
      subject: item.subject,
      chapter: item.chapter,
      topic: item.topic,
      question_type: item.question_type,
      marks: item.marks,
      difficulty: item.difficulty,
      source: item.source,
      text: item.text,
      rich_text: item.rich_text,
      answer: item.answer,
      answer_rich_text: item.answer_rich_text,
      tags: item.tags || [],
      payload: item.payload || %{},
      inserted_at: item.inserted_at
    }
  end
end
