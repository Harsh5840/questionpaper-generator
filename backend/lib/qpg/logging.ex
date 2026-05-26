defmodule Qpg.Logging do
  @moduledoc """
  Small structured logging helper used across the backend.

  The app handles provider credentials, source documents, paper text, and user
  prompts. Direct `Logger.info(inspect(payload))` calls are risky because they
  can leak secrets or flood the terminal with entire documents. This module keeps
  logs detailed enough for debugging while redacting credential-looking fields
  and truncating large strings.
  """

  require Logger

  @sensitive_key_fragments [
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "password",
    "secret",
    "token"
  ]

  @large_text_keys [
    "content",
    "document_html",
    "document_text",
    "html",
    "input",
    "payload",
    "prompt",
    "raw",
    "response",
    "text"
  ]

  @max_string_length 320

  def debug(event, fields \\ %{}), do: log(:debug, event, fields)
  def info(event, fields \\ %{}), do: log(:info, event, fields)
  def warning(event, fields \\ %{}), do: log(:warning, event, fields)
  def error(event, fields \\ %{}), do: log(:error, event, fields)

  def log(level, event, fields) do
    Logger.log(level, fn ->
      "#{event} #{inspect(sanitize(fields), limit: 50, printable_limit: 800)}"
    end)
  end

  def sanitize(value), do: do_sanitize(value, nil)

  defp do_sanitize(%{__struct__: struct} = value, _key) do
    %{struct: inspect(struct), value: inspect(value)}
  end

  defp do_sanitize(value, key) when is_map(value) do
    value
    |> Enum.map(fn {child_key, child_value} ->
      {child_key, do_sanitize(child_value, child_key)}
    end)
    |> Map.new()
    |> maybe_summarize_map(key)
  end

  defp do_sanitize(value, key) when is_list(value) do
    value
    |> Enum.take(12)
    |> Enum.map(&do_sanitize(&1, key))
    |> maybe_mark_truncated_list(value)
  end

  defp do_sanitize(value, key) when is_binary(value) do
    cond do
      sensitive_key?(key) ->
        "[REDACTED]"

      large_text_key?(key) ->
        summarize_string(value)

      String.length(value) > @max_string_length ->
        summarize_string(value)

      true ->
        value
    end
  end

  defp do_sanitize(value, _key), do: value

  defp maybe_summarize_map(map, key) do
    if large_text_key?(key) do
      %{summary: "map redacted for #{key}", keys: map |> Map.keys() |> Enum.take(20)}
    else
      map
    end
  end

  defp maybe_mark_truncated_list(sanitized, original) do
    if length(original) > length(sanitized) do
      sanitized ++ [%{truncated_items: length(original) - length(sanitized)}]
    else
      sanitized
    end
  end

  defp summarize_string(value) do
    %{
      preview: String.slice(value, 0, @max_string_length),
      chars: String.length(value)
    }
  end

  defp sensitive_key?(key) do
    key_text = key |> to_string() |> String.downcase()
    Enum.any?(@sensitive_key_fragments, &String.contains?(key_text, &1))
  end

  defp large_text_key?(key) do
    key_text = key |> to_string() |> String.downcase()
    Enum.any?(@large_text_keys, &(&1 == key_text))
  end
end
