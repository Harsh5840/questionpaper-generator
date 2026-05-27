defmodule QpgWeb.Router do
  use Phoenix.Router, helpers: false

  pipeline :api do
    plug(:accepts, ["json"])
  end

  scope "/api", QpgWeb do
    pipe_through(:api)

    get("/health", HealthController, :show)
    get("/dashboard", DashboardController, :show)
    get("/catalog/chapters", CatalogController, :chapters)
    get("/retrieval/preview", RetrievalController, :preview)
    get("/question-bank", QuestionBankController, :index)
    post("/question-bank", QuestionBankController, :create)
    post("/questions/import-from-source", QuestionImportController, :source)
    post("/questions/import-from-image", QuestionImportController, :image)
    get("/templates", TemplateController, :index)
    post("/templates", TemplateController, :create)
    post("/generation-runs", GenerationRunController, :create)
    get("/generation-runs/:id", GenerationRunController, :show)
    get("/generation-runs/:id/usage", GenerationRunController, :usage)
    get("/papers", PaperController, :index)
    get("/papers/:id/structured", PaperController, :structured)
    get("/papers/:id", PaperController, :show)
    delete("/papers/:id", PaperController, :delete)
    post("/papers/:id/versions", PaperVersionController, :create)
    post("/papers/:id/refinements", RefinementController, :create)
    post("/papers/:id/exports", ExportController, :create)
    post("/papers/:id/classroom", ClassroomController, :create)
  end
end
