/**
 * Local dev harness — NOT part of the drop-in.
 * The host app provides its own ApolloProvider wrapping PaperGeneratorPage.
 * Remove this file (and src/api/client.ts) when integrating into the host app.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApolloProvider } from "@apollo/client";
import { devClient } from "./api/client";
import PaperGeneratorPage from "./PaperGeneratorPage";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApolloProvider client={devClient}>
      <PaperGeneratorPage />
    </ApolloProvider>
  </StrictMode>
);
