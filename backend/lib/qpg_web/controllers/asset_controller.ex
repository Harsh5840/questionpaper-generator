defmodule QpgWeb.AssetController do
  use Phoenix.Controller, formats: [:json]

  alias Qpg.Logging

  @allowed_mime_types ~w(image/png image/jpeg image/webp image/gif)
  @max_bytes 5 * 1024 * 1024

  def image(conn, %{"image" => %Plug.Upload{} = upload}) do
    mime_type = upload.content_type || mime_from_filename(upload.filename || "")

    with :ok <- validate_mime_type(mime_type),
         :ok <- validate_size(upload.path),
         {:ok, asset} <- store_upload(upload, mime_type) do
      Logging.info("api.assets.image.completed", %{
        file_name: upload.filename,
        mime_type: mime_type,
        url: asset.url
      })

      json(conn, asset)
    else
      {:error, reason} ->
        Logging.warning("api.assets.image.failed", %{file_name: upload.filename, reason: inspect(reason)})
        conn |> put_status(:unprocessable_entity) |> json(%{error: error_message(reason)})
    end
  end

  def image(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "Upload an image file in the image field."})
  end

  defp validate_mime_type(mime_type) when mime_type in @allowed_mime_types, do: :ok
  defp validate_mime_type(_mime_type), do: {:error, :unsupported_image_type}

  defp validate_size(path) do
    case File.stat(path) do
      {:ok, %{size: size}} when size <= @max_bytes -> :ok
      {:ok, _stat} -> {:error, :image_too_large}
      {:error, reason} -> {:error, reason}
    end
  end

  defp store_upload(upload, mime_type) do
    extension = extension_for(mime_type, upload.filename)
    id = Ecto.UUID.generate()
    relative_dir = Path.join(["uploads", Date.utc_today() |> Date.to_iso8601()])
    upload_dir = Path.join([:code.priv_dir(:qpg) |> to_string(), "static", relative_dir])
    file_name = "#{id}#{extension}"
    destination = Path.join(upload_dir, file_name)

    url = "/" <> String.replace(Path.join(relative_dir, file_name), "\\", "/")

    with :ok <- File.mkdir_p(upload_dir),
         {:ok, _bytes} <- File.copy(upload.path, destination) do
      {:ok,
       %{
         id: id,
         url: url,
         filename: upload.filename || file_name,
         mimeType: mime_type
       }}
    end
  end

  defp extension_for("image/png", _filename), do: ".png"
  defp extension_for("image/jpeg", _filename), do: ".jpg"
  defp extension_for("image/webp", _filename), do: ".webp"
  defp extension_for("image/gif", _filename), do: ".gif"
  defp extension_for(_mime_type, filename), do: Path.extname(filename || "") || ".png"

  defp mime_from_filename(filename) do
    case String.downcase(Path.extname(filename || "")) do
      ".png" -> "image/png"
      ".jpg" -> "image/jpeg"
      ".jpeg" -> "image/jpeg"
      ".webp" -> "image/webp"
      ".gif" -> "image/gif"
      _extension -> "application/octet-stream"
    end
  end

  defp error_message(:unsupported_image_type), do: "Only PNG, JPG, WebP, and GIF images are supported."
  defp error_message(:image_too_large), do: "Image must be 5MB or smaller."
  defp error_message(reason), do: "Image upload failed: #{inspect(reason)}"
end
