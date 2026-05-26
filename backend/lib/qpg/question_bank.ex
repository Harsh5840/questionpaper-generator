defmodule Qpg.QuestionBank do
  import Ecto.Query

  alias Qpg.Logging
  alias Qpg.QuestionBank.QuestionBankItem
  alias Qpg.Repo

  def list_items(filters \\ %{}) do
    Logging.info("question_bank.list.started", %{filters: filters})

    query =
      QuestionBankItem
      |> maybe_filter(:board, filters["board"])
      |> maybe_filter(:class_level, filters["class_level"])
      |> maybe_filter(:subject, filters["subject"])
      |> maybe_filter(:chapter, filters["chapter"])
      |> maybe_filter(:topic, filters["topic"])
      |> order_by([item], desc: item.updated_at)
      |> limit(50)

    items = Repo.all(query)

    Logging.info("question_bank.list.completed", %{count: length(items)})
    items
  end

  def create_item(attrs) do
    Logging.info("question_bank.create.started", %{
      board: attrs["board"],
      class_level: attrs["class_level"],
      subject: attrs["subject"],
      chapter: attrs["chapter"],
      marks: attrs["marks"],
      difficulty: attrs["difficulty"]
    })

    %QuestionBankItem{}
    |> QuestionBankItem.changeset(attrs)
    |> Repo.insert()
    |> tap(fn
      {:ok, item} ->
        Logging.info("question_bank.create.completed", %{id: item.id})

      {:error, changeset} ->
        Logging.error("question_bank.create.failed", %{errors: changeset.errors})
    end)
  end

  def result_blocks(filters, limit_count \\ 8) do
    filters
    |> list_items()
    |> Enum.take(limit_count)
    |> Enum.map(&to_retrieval_result/1)
  end

  def to_retrieval_result(%QuestionBankItem{} = item) do
    %{
      id: item.id,
      source_type: "question_bank",
      title: item.chapter || item.topic || "Saved question",
      excerpt: item.text,
      text: item.text,
      citation: "QUESTION BANK / #{item.chapter || item.topic || item.id}",
      metadata: %{
        board: item.board,
        class_level: item.class_level,
        subject: item.subject,
        chapter: item.chapter,
        topic: item.topic
      },
      marks: item.marks,
      difficulty: item.difficulty,
      question_type: item.question_type,
      source: item.source,
      tags: item.tags || [],
      payload: item.payload || %{}
    }
  end

  defp maybe_filter(query, _field, value) when value in [nil, "", []], do: query

  defp maybe_filter(query, field, value) do
    where(query, [item], fragment("lower(?) = lower(?)", field(item, ^field), ^to_string(value)))
  end
end
