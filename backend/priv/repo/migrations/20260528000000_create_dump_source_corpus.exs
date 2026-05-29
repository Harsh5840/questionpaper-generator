defmodule Qpg.Repo.Migrations.CreateDumpSourceCorpus do
  use Ecto.Migration

  def up do
    execute("CREATE EXTENSION IF NOT EXISTS vector")

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_textbooks (
      id uuid PRIMARY KEY,
      title varchar(255) NOT NULL,
      subject varchar(255) NOT NULL,
      grade varchar(255) NOT NULL,
      publisher varchar(255) DEFAULT 'NCERT',
      edition varchar(255),
      discipline varchar(255),
      pdf_path varchar(255),
      page_image_paths varchar(255)[] DEFAULT ARRAY[]::varchar[],
      total_pages integer,
      status varchar(255) DEFAULT 'pending',
      ingestion_metadata jsonb DEFAULT '{}'::jsonb,
      error_message text,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL,
      cover_image_path varchar(255),
      book_type varchar(255)
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_chapters (
      id uuid PRIMARY KEY,
      textbook_id uuid NOT NULL REFERENCES ingested_textbooks(id) ON DELETE CASCADE,
      title varchar(255) NOT NULL,
      chapter_number integer,
      order_index integer DEFAULT 0,
      page_start integer,
      page_end integer,
      markdown_store jsonb,
      extraction_store jsonb,
      status varchar(255) DEFAULT 'pending',
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL,
      paper_metadata jsonb,
      extraction_metadata jsonb,
      parent_chapter_id uuid REFERENCES ingested_chapters(id) ON DELETE SET NULL,
      set_number integer,
      bifurcation_store jsonb
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_subtopics (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      section_number varchar(255),
      page integer,
      order_index integer DEFAULT 0,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS book_index_entries (
      id uuid PRIMARY KEY,
      textbook_id uuid NOT NULL REFERENCES ingested_textbooks(id) ON DELETE CASCADE,
      grade varchar(255) NOT NULL,
      subject varchar(255) NOT NULL,
      label varchar(255) NOT NULL,
      title varchar(255) NOT NULL,
      parent_id uuid REFERENCES book_index_entries(id) ON DELETE SET NULL,
      depth integer DEFAULT 0 NOT NULL,
      order_index integer DEFAULT 0,
      canonical_slug text NOT NULL,
      page_start integer,
      page_end integer,
      source varchar(255) DEFAULT 'extraction',
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS master_index_lists (
      id uuid PRIMARY KEY,
      grade varchar(255) NOT NULL,
      subject varchar(255) NOT NULL,
      board varchar(255) NOT NULL,
      book_ids uuid[] DEFAULT ARRAY[]::uuid[],
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS master_index_entries (
      id uuid PRIMARY KEY,
      grade varchar(255) NOT NULL,
      subject varchar(255) NOT NULL,
      label varchar(255) NOT NULL,
      title varchar(255) NOT NULL,
      parent_id uuid REFERENCES master_index_entries(id) ON DELETE SET NULL,
      depth integer DEFAULT 0 NOT NULL,
      order_index integer DEFAULT 0 NOT NULL,
      canonical_slug varchar(255) NOT NULL,
      source_textbook_ids uuid[] DEFAULT ARRAY[]::uuid[],
      source_book_entry_ids uuid[] DEFAULT ARRAY[]::uuid[],
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL,
      master_index_list_id uuid NOT NULL REFERENCES master_index_lists(id) ON DELETE CASCADE
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS chapter_chunks (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      textbook_id uuid NOT NULL REFERENCES ingested_textbooks(id) ON DELETE CASCADE,
      section_label varchar(255),
      section_title varchar(255),
      page integer,
      origin varchar(255) NOT NULL,
      content text NOT NULL,
      embedding vector(3072) NOT NULL,
      embedding_model varchar(255) NOT NULL,
      token_count integer,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS chapter_paragraph_keywords (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      textbook_id uuid NOT NULL REFERENCES ingested_textbooks(id) ON DELETE CASCADE,
      paragraph_index integer NOT NULL,
      section_label varchar(255),
      section_title varchar(255),
      subsection_title varchar(255),
      page integer,
      kind varchar(255) NOT NULL,
      text text NOT NULL,
      keywords jsonb DEFAULT '[]'::jsonb NOT NULL,
      concepts jsonb DEFAULT '[]'::jsonb NOT NULL,
      definitions jsonb DEFAULT '[]'::jsonb NOT NULL,
      topic_summary text,
      is_skippable boolean DEFAULT false NOT NULL,
      model varchar(255),
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_questions (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      text text NOT NULL,
      question_type text DEFAULT 'short_answer',
      difficulty text,
      source_label text,
      category text,
      marks_possible integer,
      solution text,
      hints text[] DEFAULT ARRAY[]::text[],
      options text[] DEFAULT ARRAY[]::text[],
      body_store jsonb,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL,
      book_index_entry_id uuid REFERENCES book_index_entries(id) ON DELETE SET NULL,
      or_alternative_of_id uuid REFERENCES ingested_questions(id) ON DELETE SET NULL,
      order_index integer
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS skills (
      id uuid PRIMARY KEY,
      grade varchar(255) NOT NULL,
      subject varchar(255) NOT NULL,
      chapter varchar(255) NOT NULL,
      skill_name varchar(255) NOT NULL,
      description text,
      key_formulas text[] DEFAULT ARRAY[]::text[],
      common_mistakes text[] DEFAULT ARRAY[]::text[],
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL,
      auto_generated boolean DEFAULT false,
      source_question_id uuid REFERENCES ingested_questions(id) ON DELETE SET NULL,
      book_index_entry_id uuid REFERENCES book_index_entries(id) ON DELETE SET NULL,
      master_index_entry_id uuid REFERENCES master_index_entries(id) ON DELETE SET NULL,
      board varchar(255),
      category varchar(255),
      subcategory varchar(255)
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS formulas (
      id uuid PRIMARY KEY,
      name varchar(255) NOT NULL,
      display_name varchar(255),
      latex_katex text NOT NULL,
      subject varchar(255) NOT NULL,
      category varchar(255),
      subcategory varchar(255),
      strand varchar(255),
      tier varchar(255),
      difficulty_tier varchar(255),
      description text,
      when_to_use text,
      common_mistakes text,
      visual_memory_aid text,
      grade_levels integer[] DEFAULT ARRAY[]::integer[],
      keywords text[] DEFAULT ARRAY[]::text[],
      aliases text[] DEFAULT ARRAY[]::text[],
      topics text[] DEFAULT ARRAY[]::text[],
      related_formula_names text[] DEFAULT ARRAY[]::text[],
      canonical_token varchar(255),
      is_k12 boolean DEFAULT true,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL,
      auto_generated boolean DEFAULT false,
      source_question_id uuid REFERENCES ingested_questions(id) ON DELETE SET NULL,
      book_index_entry_id uuid REFERENCES book_index_entries(id) ON DELETE SET NULL,
      master_index_entry_id uuid REFERENCES master_index_entries(id) ON DELETE SET NULL,
      board varchar(255)
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_formulas (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      latex text,
      description text,
      conditions text,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_question_skills (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL REFERENCES ingested_questions(id) ON DELETE CASCADE,
      skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      is_primary boolean DEFAULT false,
      confidence double precision DEFAULT 1.0,
      reasoning text,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_question_formulas (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL REFERENCES ingested_questions(id) ON DELETE CASCADE,
      formula_id uuid NOT NULL REFERENCES formulas(id) ON DELETE CASCADE,
      is_primary boolean DEFAULT false,
      confidence double precision DEFAULT 1.0,
      reasoning text,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS question_book_index_links (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL REFERENCES ingested_questions(id) ON DELETE CASCADE,
      book_index_entry_id uuid NOT NULL REFERENCES book_index_entries(id) ON DELETE CASCADE,
      confidence double precision DEFAULT 1.0,
      source varchar(255) DEFAULT 'extraction',
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS question_master_index_links (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL REFERENCES ingested_questions(id) ON DELETE CASCADE,
      master_index_entry_id uuid NOT NULL REFERENCES master_index_entries(id) ON DELETE CASCADE,
      confidence double precision DEFAULT 1.0,
      source varchar(255) DEFAULT 'backfill',
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_chapter_reviews (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      reviewer_name varchar(255) NOT NULL,
      status varchar(255) NOT NULL,
      remark text,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_chapter_review_flags (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      page_number integer NOT NULL,
      flagged_type varchar(255) NOT NULL,
      note text,
      flagged_by varchar(255),
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS ingested_question_reviews (
      id uuid PRIMARY KEY,
      question_id uuid NOT NULL REFERENCES ingested_questions(id) ON DELETE CASCADE,
      reviewer_name varchar(255) NOT NULL,
      status varchar(255) NOT NULL,
      remark text,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    execute("""
    CREATE TABLE IF NOT EXISTS pending_screenshot_questions (
      id uuid PRIMARY KEY,
      chapter_id uuid NOT NULL REFERENCES ingested_chapters(id) ON DELETE CASCADE,
      batch_id uuid NOT NULL,
      target_block_label varchar(255) NOT NULL,
      target_block_kind varchar(255) NOT NULL,
      claimed_question_number varchar(255),
      claimed_page_numbers integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
      checker_comment text,
      screenshot_store jsonb NOT NULL,
      raw_payload jsonb NOT NULL,
      edited_payload jsonb,
      order_in_batch integer NOT NULL,
      status varchar(255) DEFAULT 'pending' NOT NULL,
      approved_question_id uuid REFERENCES ingested_questions(id) ON DELETE SET NULL,
      rejected_reason varchar(255),
      approved_at timestamp without time zone,
      rejected_at timestamp without time zone,
      inserted_at timestamp(0) without time zone NOT NULL,
      updated_at timestamp(0) without time zone NOT NULL
    )
    """)

    create_indexes()
  end

  def down do
    execute("DROP TABLE IF EXISTS pending_screenshot_questions")
    execute("DROP TABLE IF EXISTS ingested_question_reviews")
    execute("DROP TABLE IF EXISTS ingested_chapter_review_flags")
    execute("DROP TABLE IF EXISTS ingested_chapter_reviews")
    execute("DROP TABLE IF EXISTS question_master_index_links")
    execute("DROP TABLE IF EXISTS question_book_index_links")
    execute("DROP TABLE IF EXISTS ingested_question_formulas")
    execute("DROP TABLE IF EXISTS ingested_question_skills")
    execute("DROP TABLE IF EXISTS ingested_formulas")
    execute("DROP TABLE IF EXISTS formulas")
    execute("DROP TABLE IF EXISTS skills")
    execute("DROP TABLE IF EXISTS ingested_questions")
    execute("DROP TABLE IF EXISTS chapter_paragraph_keywords")
    execute("DROP TABLE IF EXISTS chapter_chunks")
    execute("DROP TABLE IF EXISTS master_index_entries")
    execute("DROP TABLE IF EXISTS master_index_lists")
    execute("DROP TABLE IF EXISTS book_index_entries")
    execute("DROP TABLE IF EXISTS ingested_subtopics")
    execute("DROP TABLE IF EXISTS ingested_chapters")
    execute("DROP TABLE IF EXISTS ingested_textbooks")
  end

  defp create_indexes do
    execute(
      "CREATE INDEX IF NOT EXISTS ingested_textbooks_grade_subject_idx ON ingested_textbooks (grade, subject)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_textbooks_book_type_idx ON ingested_textbooks (book_type)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_textbooks_title_idx ON ingested_textbooks (lower(title))"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_chapters_textbook_order_idx ON ingested_chapters (textbook_id, order_index)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_chapters_title_idx ON ingested_chapters (lower(title))"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_subtopics_chapter_order_idx ON ingested_subtopics (chapter_id, order_index)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS chapter_chunks_chapter_idx ON chapter_chunks (chapter_id)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS chapter_chunks_textbook_idx ON chapter_chunks (textbook_id)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS chapter_chunks_section_idx ON chapter_chunks (chapter_id, section_label)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_questions_chapter_order_idx ON ingested_questions (chapter_id, order_index)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_questions_category_idx ON ingested_questions (category)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_questions_type_marks_idx ON ingested_questions (question_type, marks_possible, difficulty)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_questions_or_idx ON ingested_questions (or_alternative_of_id)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS book_index_entries_textbook_order_idx ON book_index_entries (textbook_id, order_index)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS master_index_entries_list_order_idx ON master_index_entries (master_index_list_id, order_index)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_question_skills_question_idx ON ingested_question_skills (question_id)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_question_formulas_question_idx ON ingested_question_formulas (question_id)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS question_book_index_links_question_idx ON question_book_index_links (question_id)"
    )

    execute(
      "CREATE INDEX IF NOT EXISTS question_master_index_links_question_idx ON question_master_index_links (question_id)"
    )

    execute("CREATE INDEX IF NOT EXISTS skills_scope_idx ON skills (grade, subject, chapter)")
    execute("CREATE INDEX IF NOT EXISTS formulas_scope_idx ON formulas (subject, category)")

    execute(
      "CREATE INDEX IF NOT EXISTS ingested_formulas_chapter_idx ON ingested_formulas (chapter_id)"
    )

    # pgvector ivfflat indexes are capped below the dump's 3072-dimension
    # Gemini embeddings. We keep `vector(3072)` as the storage/search type and
    # use exact search for now; a later optimization can add halfvec or
    # projected/subvector indexes without changing the source table shape.
  end
end
