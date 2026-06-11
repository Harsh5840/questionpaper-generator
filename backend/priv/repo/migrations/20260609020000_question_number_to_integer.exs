defmodule Qpg.Repo.Migrations.QuestionNumberToInteger do
  use Ecto.Migration

  # `question_number` was stored as text ("1", "2", …) with NULL on section rows.
  # All non-null values are plain integers, so convert the column to a real
  # integer to match the prod model (question_number is an int there).

  def up do
    execute("""
    ALTER TABLE assignment_questions
      ALTER COLUMN question_number TYPE integer
      USING NULLIF(question_number, '')::integer
    """)
  end

  def down do
    execute("""
    ALTER TABLE assignment_questions
      ALTER COLUMN question_number TYPE text
      USING question_number::text
    """)
  end
end
