import { renderLatex, type LatexMode } from "@/lib/latex-render";

type LatexTextProps = {
  children: string | null | undefined;
  mode?: LatexMode;
  as?: "span" | "div" | "p";
  className?: string;
};

// Renders a question/option/answer string that may contain `$...$` math.
// Math → KaTeX, everything else → DOMPurify-sanitized HTML.
export function LatexText({ children, mode = "explicit", as = "span", className }: LatexTextProps) {
  const Tag = as;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: renderLatex(children, mode) }} />;
}
