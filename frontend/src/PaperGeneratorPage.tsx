import { StudioApp } from "./features/studio/studio-app";

/**
 * Drop-in component for the paper generator feature.
 * Mount inside the host app's ApolloProvider + Router:
 *   <Route path="/teacher/assignments/paper-generator" element={<PaperGeneratorPage />} />
 */
export default function PaperGeneratorPage() {
  return <StudioApp />;
}
