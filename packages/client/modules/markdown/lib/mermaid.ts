import DOMPurify from "dompurify";
import { mount, render, type Mounted } from "pele";
import "./mermaid.css";

export interface MermaidBlock {
  element: HTMLElement;
  destroy: () => void;
}

function button(label: string, path: string, action: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "mermaid-action";
  element.title = label;
  element.setAttribute("aria-label", label);
  element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  element.addEventListener("click", action);
  return element;
}

export function createMermaidBlock(
  source: string,
  actions: { expand: () => void; source?: () => void } = { expand: () => {} },
): MermaidBlock {
  const element = document.createElement("figure");
  element.className = "mermaid-diagram";
  element.dataset.mermaidSource = source;
  element.contentEditable = "false";

  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-toolbar";
  const label = document.createElement("span");
  label.textContent = "Mermaid";
  toolbar.append(label);
  if (actions.source)
    toolbar.append(
      button(
        "Редактировать исходный код",
        '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>',
        actions.source,
      ),
    );
  toolbar.append(
    button(
      "Раскрыть диаграмму",
      '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
      actions.expand,
    ),
  );

  const canvas = document.createElement("div");
  canvas.className = "mermaid-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Диаграмма Mermaid");
  canvas.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, button, input")) return;
    actions.expand();
  });
  element.append(toolbar, canvas);

  const mounted: Mounted = mount(canvas, source, {
    zoom: "auto",
    sanitize: (svg) =>
      DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        RETURN_DOM: true,
      }) as HTMLElement,
  });

  return {
    element,
    destroy() {
      mounted.destroy();
    },
  };
}

const themeVariables = {
  "--pele-bg": "--bg",
  "--pele-fg": "--text",
  "--pele-muted": "--muted",
  "--pele-line": "--text-2",
  "--pele-surface": "--bg-2",
  "--pele-surface-alt": "--bg-3",
  "--pele-border": "--line-strong",
  "--pele-accent": "--info",
  "--pele-critical": "--err",
  "--pele-error": "--err",
  "--pele-font": "--sans",
  "--pele-font-mono": "--mono",
} as const;

export function renderMermaidPreview(source: string): {
  svg: string;
  width: number;
  height: number;
} {
  const result = render(source, { responsive: false });
  const sanitized = DOMPurify.sanitize(result.svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM: true,
  }) as HTMLElement;
  const svg = sanitized instanceof SVGSVGElement ? sanitized : sanitized.querySelector("svg");
  if (!svg) throw new Error("Pele returned no SVG");
  for (const [pele, projector] of Object.entries(themeVariables))
    svg.style.setProperty(pele, `var(${projector})`);
  return { svg: svg.outerHTML, width: result.width, height: result.height };
}
