alias Qpg.Repo

Repo.insert_all("source_documents", [
  %{
    id: Ecto.UUID.dump!(Ecto.UUID.generate()),
    source_type: "NCERT",
    title: "Class 10 Maths Algebra Demo",
    board: "CBSE",
    class_level: "10",
    subject: "Maths",
    chapter: "Algebra",
    topic: "Quadratic Equations",
    inserted_at: DateTime.utc_now() |> DateTime.truncate(:second),
    updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
  }
])
