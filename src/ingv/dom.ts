type Child = Node | string | null | undefined | false;

/** A small element builder: `el("button", { class: "x", onclick }, "Text")`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key in node && key !== "list") {
      (node as unknown as Record<string, unknown>)[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** An external link, opened outside GeoLibre. */
export const extLink = (href: string, text: string, cls = "") =>
  el("a", { href, target: "_blank", rel: "noopener noreferrer", class: cls || undefined }, text);

/** A dot of the given colour. */
export const dot = (color: string) => el("span", { class: "ingq-dot", style: { background: color } });

/** An image shown only once it has loaded: a missing INGV product answers 404. */
export function probeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}
