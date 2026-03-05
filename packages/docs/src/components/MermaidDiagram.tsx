import { renderMermaidSVGAsync, fromShikiTheme } from "beautiful-mermaid";
import { getSingletonHighlighter } from "shiki";

interface MermaidDiagramProps {
  code: string;
  /** Extra CSS to apply to the container div */
  style?: React.CSSProperties;
}

export async function MermaidDiagram({ code, style }: MermaidDiagramProps) {
  const hl = await getSingletonHighlighter({ themes: ["github-light"] });
  const colors = fromShikiTheme(hl.getTheme("github-light"));
  const svg = await renderMermaidSVGAsync(code.trim(), {
    ...colors,
    transparent: true,
    font: "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: 24,
    nodeSpacing: 20,
    layerSpacing: 32,
  });

  // Make the SVG responsive and round subgraph containers
  const responsiveSvg = svg
    .replace(/\bwidth="[^"]*"/, "")
    .replace(/\bheight="[^"]*"/, "")
    .replace(/style="/, 'style="width:100%;height:auto;display:block;')
    .replace(
      /(<g class="subgraph"[^>]*>[\s\S]*?<rect[^>]*?)rx="0" ry="0"([^>]*>[\s\S]*?<rect[^>]*?)rx="0" ry="0"/g,
      "$1rx=\"8\" ry=\"8\"$2rx=\"8\" ry=\"8\"",
    );

  return (
    <div
      className="mermaid-diagram"
      style={{
        margin: "1.5rem 0",
        borderRadius: 8,
        overflow: "hidden",
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: responsiveSvg }}
    />
  );
}
