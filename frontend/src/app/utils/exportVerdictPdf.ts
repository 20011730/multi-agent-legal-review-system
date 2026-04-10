import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";

function canvasToJpegDataUrl(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

/** oklch 등 html-to-image가 직렬화 못 하는 테마 변수를 RGB 계열로 덮어씁니다. */
function injectPdfSafeTheme(host: HTMLElement): () => void {
  const el = document.createElement("style");
  el.setAttribute("data-verdict-pdf-theme", "");
  el.textContent = `
    .verdict-pdf-root {
      color: #0f172a;
      --foreground: #0f172a;
      --card-foreground: #0f172a;
      --muted-foreground: #64748b;
      --secondary: #f1f5f9;
      --secondary-foreground: #0f172a;
      --ring: #94a3b8;
      --border: rgba(0,0,0,0.1);
      --popover: #ffffff;
      --popover-foreground: #0f172a;
    }
  `;
  host.insertAdjacentElement("beforebegin", el);
  return () => {
    el.remove();
  };
}

async function captureElement(
  element: HTMLElement,
  pixelRatio: number,
  skipFonts: boolean
): Promise<HTMLCanvasElement> {
  const width = Math.max(element.scrollWidth, element.offsetWidth);
  const height = Math.max(element.scrollHeight, element.offsetHeight);

  return toCanvas(element, {
    pixelRatio,
    backgroundColor: "#ffffff",
    width,
    height,
    cacheBust: true,
    skipFonts,
    filter: (node) => {
      const tag = node.tagName;
      if (tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED") {
        return false;
      }
      return true;
    },
  });
}

/**
 * DOM 요소를 여러 페이지 A4 PDF로 저장합니다.
 * Tailwind 4 등 oklch 색상은 html2canvas 대신 html-to-image(SVG 기반)로 처리합니다.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const asciiName = filename.replace(/[^\w.\-()]/g, "_");
  const safeName = asciiName.toLowerCase().endsWith(".pdf") ? asciiName : `${asciiName}.pdf`;

  const removeTheme = injectPdfSafeTheme(element);
  let canvas: HTMLCanvasElement;
  try {
    try {
      canvas = await captureElement(element, 2, false);
    } catch (a) {
      console.warn("PDF capture r=2 fonts on failed, retry:", a);
      try {
        canvas = await captureElement(element, 2, true);
      } catch (b) {
        console.warn("PDF capture r=2 skipFonts failed, retry r=1:", b);
        try {
          canvas = await captureElement(element, 1, false);
        } catch (c) {
          console.warn("PDF capture r=1 fonts on failed, last retry:", c);
          canvas = await captureElement(element, 1, true);
        }
      }
    }
  } catch (last) {
    console.error("PDF capture failed:", last);
    throw last;
  } finally {
    removeTheme();
  }

  const imgData = canvasToJpegDataUrl(canvas);
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let y = 0;

  const fmt = imgData.startsWith("data:image/png") ? "PNG" : "JPEG";
  pdf.addImage(imgData, fmt, 0, y, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    y = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, fmt, 0, y, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(safeName);
}
