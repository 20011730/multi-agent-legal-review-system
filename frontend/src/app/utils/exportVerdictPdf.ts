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

    /* PDF 전용 page-break 처리 */
    .verdict-pdf-root [data-slot="card"] {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .verdict-pdf-root .pdf-section {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* 스크롤 영역 해제 — PDF에서 잘림 방지 */
    .verdict-pdf-root,
    .verdict-pdf-root * {
      overflow: visible !important;
      max-height: none !important;
    }

    /* 아코디언 상세 패널 강제 펼침 (PDF에서는 접힌 상태면 안 보이므로) */
    .verdict-pdf-root [data-state="closed"] {
      display: block !important;
      height: auto !important;
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
 * - 카드/섹션 단위로 break-inside: avoid 적용
 * - 스크롤 영역을 풀어서 잘림 방지
 * - 여러 페이지에 걸쳐 올바르게 분할
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const asciiName = filename.replace(/[^\w.\-()]/g, "_");
  const safeName = asciiName.toLowerCase().endsWith(".pdf") ? asciiName : `${asciiName}.pdf`;

  const removeTheme = injectPdfSafeTheme(element);

  // 캡처 전 레이아웃 안정화 대기
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

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

  // 마진 설정 (상하좌우)
  const margin = 5; // mm
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const fmt = imgData.startsWith("data:image/png") ? "PNG" : "JPEG";

  if (imgHeight <= usableHeight) {
    // 단일 페이지
    pdf.addImage(imgData, fmt, margin, margin, imgWidth, imgHeight);
  } else {
    // 다중 페이지 — 각 페이지별 올바른 영역 잘라서 배치
    let heightLeft = imgHeight;
    let srcY = 0;

    while (heightLeft > 0) {
      if (srcY > 0) {
        pdf.addPage();
      }

      const sliceHeight = Math.min(usableHeight, heightLeft);

      // 전체 이미지를 페이지에 맞게 배치 (y offset으로 슬라이스)
      pdf.addImage(
        imgData,
        fmt,
        margin,
        margin - srcY,  // 음수 offset으로 이전 페이지 부분 숨김
        imgWidth,
        imgHeight
      );

      srcY += usableHeight;
      heightLeft -= usableHeight;
    }
  }

  pdf.save(safeName);
}
