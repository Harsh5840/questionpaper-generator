defmodule Qpg.Repo.Migrations.SetClass10MathsChapterOrder do
  use Ecto.Migration

  def up do
    execute("""
    UPDATE chapters c
    SET position = positions.chapter_position
    FROM subjects s,
      school_classes sc,
      boards b,
      (
        VALUES
          ('Real Numbers', 1),
          ('Polynomials', 2),
          ('Pair Of Linear Equations In Two Variables', 3),
          ('Quadratic Equations', 4),
          ('Arithmetic Progressions', 5),
          ('Triangles', 6),
          ('Coordinate Geometry', 7),
          ('Introduction To Trigonometry', 8),
          ('Some Applications Of Trigonometry', 9),
          ('Circles', 10),
          ('Areas Related To Circles', 11),
          ('Surface Areas And Volumes', 12),
          ('Statistics', 13),
          ('Probability', 14)
      ) AS positions(chapter_name, chapter_position)
    WHERE c.subject_id = s.id
      AND sc.id = s.school_class_id
      AND b.id = sc.board_id
      AND lower(b.code) = 'cbse'
      AND sc.level = '10'
      AND lower(s.name) = 'maths'
      AND c.name = positions.chapter_name
    """)
  end

  def down, do: :ok
end
