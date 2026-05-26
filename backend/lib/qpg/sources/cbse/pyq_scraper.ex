defmodule Qpg.Sources.Cbse.PyqScraper do
  @moduledoc """
  Downloads official CBSE previous-year question-paper PDFs for local PYQ analysis.
  """

  alias Qpg.Logging

  @index_url "https://www.cbse.gov.in/cbsenew/question-paper.html"
  @base_uri URI.parse(@index_url)

  def scrape(opts \\ []) do
    class_level = Keyword.get(opts, :class_level, "10")
    subject_match = Keyword.get(opts, :subject_match, ~r/MATHEMATICS/i)
    output_dir = Keyword.get(opts, :output_dir, "../data/pyq/raw/cbse/class-#{class_level}/maths")
    limit = Keyword.get(opts, :limit, 6)
    max_size_mb = Keyword.get(opts, :max_size_mb, 20)

    Logging.info("sources.cbse.pyq_scraper.started", %{
      class_level: class_level,
      output_dir: output_dir,
      limit: limit,
      max_size_mb: max_size_mb
    })

    with {:ok, html} <- fetch(@index_url) do
      entries =
        html
        |> extract_entries(class_level, subject_match)
        |> Enum.take(limit)

      File.mkdir_p!(output_dir)

      results =
        Enum.map(entries, fn entry ->
          download_entry(entry, output_dir, max_size_mb)
        end)

      manifest_path = Path.join(output_dir, "manifest.json")

      File.write!(
        manifest_path,
        Jason.encode!(%{source: @index_url, entries: results}, pretty: true)
      )

      Logging.info("sources.cbse.pyq_scraper.completed", %{
        manifest: manifest_path,
        discovered_count: length(entries),
        downloaded_count: Enum.count(results, &(&1.status == "downloaded")),
        skipped_count: Enum.count(results, &String.starts_with?(to_string(&1.status), "skipped")),
        failed_count: Enum.count(results, &(&1.status == "failed"))
      })

      {:ok, %{manifest: manifest_path, entries: results}}
    end
  end

  defp extract_entries(html, class_level, subject_match) do
    class_path = if class_level == "10", do: "X", else: "XII"

    Regex.scan(
      ~r/<tr>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>\s*Download\s*<\/a>\s*<\/td>.*?<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<\/tr>/is,
      html
    )
    |> Enum.map(fn [_, subject_html, href, size] ->
      year =
        case Regex.run(~r/question-paper\/(\d{4})/i, href) do
          [_, value] -> value
          _ -> "unknown"
        end

      %{
        year: year,
        class_level: class_level,
        subject: subject_html |> strip_html() |> String.trim(),
        size: String.trim(size),
        url: absolute_url(href)
      }
    end)
    |> Enum.filter(fn entry ->
      Regex.match?(subject_match, entry.subject) and
        String.contains?(entry.url, "/#{class_path}/")
    end)
    |> Enum.uniq_by(& &1.url)
  end

  defp download_entry(entry, output_dir, max_size_mb) do
    extension = entry.url |> URI.parse() |> Map.get(:path, "") |> Path.extname()

    file_name =
      "#{entry.year}-class-#{entry.class_level}-#{slug(entry.subject)}#{extension}"

    path = Path.join(output_dir, file_name)

    if size_mb(entry.size) > max_size_mb do
      Map.merge(entry, %{file: path, status: "skipped_large_file", max_size_mb: max_size_mb})
    else
      do_download_entry(entry, path)
    end
  end

  defp do_download_entry(entry, path) do
    Logging.info("sources.cbse.pyq_scraper.download.started", %{
      url: entry.url,
      file: path,
      size: entry.size
    })

    case fetch(entry.url) do
      {:ok, body} ->
        File.write!(path, body)

        Logging.info("sources.cbse.pyq_scraper.download.completed", %{
          file: path,
          bytes: byte_size(body)
        })

        Map.merge(entry, %{file: path, status: "downloaded"})

      {:error, reason} ->
        Logging.error("sources.cbse.pyq_scraper.download.failed", %{file: path, reason: reason})
        Map.merge(entry, %{file: path, status: "failed", reason: reason})
    end
  end

  defp size_mb(size) do
    case Regex.run(~r/([\d.]+)\s*MB/i, size || "") do
      [_, value] -> String.to_float(value)
      _ -> 0.0
    end
  end

  defp fetch(url) do
    Logging.debug("sources.cbse.pyq_scraper.fetch.started", %{url: url})
    request = Finch.build(:get, url)

    case Finch.request(request, Qpg.Finch, receive_timeout: 60_000) do
      {:ok, %{status: status, body: body}} when status in 200..299 ->
        Logging.debug("sources.cbse.pyq_scraper.fetch.completed", %{
          url: url,
          status: status,
          bytes: byte_size(body)
        })

        {:ok, body}

      {:ok, %{status: status}} ->
        Logging.warning("sources.cbse.pyq_scraper.fetch.non_success", %{url: url, status: status})
        {:error, "HTTP #{status}"}

      {:error, reason} ->
        Logging.warning("sources.cbse.pyq_scraper.fetch.finch_failed_using_httpc", %{
          url: url,
          reason: inspect(reason)
        })

        fetch_with_httpc(url)
    end
  end

  defp fetch_with_httpc(url) do
    :inets.start()
    :ssl.start()

    case :httpc.request(:get, {String.to_charlist(url), []}, [timeout: 60_000],
           body_format: :binary
         ) do
      {:ok, {{_, status, _}, _headers, body}} when status in 200..299 -> {:ok, body}
      {:ok, {{_, status, _}, _headers, _body}} -> {:error, "HTTP #{status}"}
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp absolute_url(href) do
    href
    |> URI.parse()
    |> then(fn
      %URI{scheme: nil} = uri -> URI.merge(@base_uri, uri) |> URI.to_string()
      uri -> URI.to_string(uri)
    end)
  end

  defp strip_html(value), do: String.replace(value, ~r/<[^>]+>/, " ")

  defp slug(value) do
    value
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/, "-")
    |> String.trim("-")
  end
end
