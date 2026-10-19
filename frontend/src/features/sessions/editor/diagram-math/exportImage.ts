/**
 * Saving a drawn diagram as an image (FR-043). The note is never changed. Uses the cleaned SVG
 * (no external references), so the PNG canvas is never tainted.
 */

function withBackground(svg: string, background: string): { text: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement as unknown as SVGSVGElement;
  const vb = root.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const [x, y, width, height] = vb && vb.length === 4 ? vb : [0, 0, 800, 600];
  const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of Object.entries({ x, y, width, height, fill: background })) rect.setAttribute(k, String(v));
  root.insertBefore(rect, root.firstChild);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.removeAttribute("style");
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { text: new XMLSerializer().serializeToString(root), width, height };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileBaseName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").trim();
  return safe || "diagram";
}

export function exportSvg(svg: string, background: string, name: string) {
  const { text } = withBackground(svg, background);
  download(new Blob([text], { type: "image/svg+xml" }), `${fileBaseName(name)}.svg`);
}

export async function exportPng(svg: string, background: string, name: string) {
  const { text, width, height } = withBackground(svg, background);
  const scale = 2;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not make the PNG");
  download(blob, `${fileBaseName(name)}.png`);
}
