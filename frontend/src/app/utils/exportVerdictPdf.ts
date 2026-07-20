import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";

function canvasToJpegDataUrl(canvas: HTMLCanvasElement): string {
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return canvas.toDataURL("image/png");
  }
}

/**
 * oklch 등 html-to-image가 직렬화 못 하는 테마 변수를 RGB 계열로 덮어씁니다.
 * host 요소에 verdict-pdf-root 클래스를 추가하고, 정리 시 제거합니다.
 */
function injectPdfSafeTheme(host: HTMLElement): () => void {
  host.classList.add("verdict-pdf-root");

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

    /* 스크롤 영역 해제 — PDF에서 잘림 방지 */
    .verdict-pdf-root,
    .verdict-pdf-root * {
      overflow: visible !important;
      max-height: none !important;
    }

    /* 아코디언 상세 패널 강제 펼침 */
    .verdict-pdf-root [data-state="closed"] {
      display: block !important;
      height: auto !important;
    }
  `;
  host.insertAdjacentElement("beforebegin", el);

  return () => {
    host.classList.remove("verdict-pdf-root");
    el.remove();
  };
}

async function captureElement(
  element: HTMLElement,
  pixelRatio: number,
  skipFonts: boolean
): Promise<HTMLCanvasElement> {
  // getBoundingClientRect로 sub-pixel 정밀 측정 후 ceil → 마지막 border 픽셀이 잘리지 않도록
  const rect = element.getBoundingClientRect();
  const measuredW = Math.max(element.scrollWidth, element.offsetWidth, Math.ceil(rect.width));
  const measuredH = Math.max(element.scrollHeight, element.offsetHeight, Math.ceil(rect.height));

  // 하단 잘림 방지용 안전 여유분 (디바이스 픽셀 비율과 무관하게 8px 확보)
  // 4px도 일부 환경에서 마지막 border 픽셀이 가려지는 현상이 있어 8px로 증가
  const SAFETY_PAD = 8;
  const width = measuredW;
  const height = measuredH + SAFETY_PAD;

  return toCanvas(element, {
    pixelRatio,
    backgroundColor: "#ffffff",
    width,
    height,
    cacheBust: true,
    skipFonts,
    filter: (node) => {
      const tag = (node as HTMLElement).tagName;
      if (tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED") return false;
      return true;
    },
  });
}

async function captureWithFallback(element: HTMLElement): Promise<HTMLCanvasElement> {
  try {
    return await captureElement(element, 2, false);
  } catch (a) {
    console.warn("PDF capture r=2 fonts on failed, retry:", a);
  }
  try {
    return await captureElement(element, 2, true);
  } catch (b) {
    console.warn("PDF capture r=2 skipFonts failed, retry r=1:", b);
  }
  try {
    return await captureElement(element, 1, false);
  } catch (c) {
    console.warn("PDF capture r=1 fonts on failed, last retry:", c);
  }
  return captureElement(element, 1, true);
}

/**
 * DOM 요소의 직접 자식(카드/섹션 단위)을 각각 캡처하여
 * 카드가 페이지 중간에서 잘리지 않도록 A4 PDF로 저장합니다.
 *
 * - 각 섹션을 독립 캔버스로 캡처 → 페이지에 남은 공간에 맞으면 이어 붙이고
 *   자리가 부족하면 새 페이지를 시작합니다.
 * - 단일 섹션이 A4 한 페이지보다 높은 경우에만 내부에서 슬라이스합니다.
 */
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const asciiName = filename.replace(/[^\w.\-()]/g, "_");
  const safeName = asciiName.toLowerCase().endsWith(".pdf") ? asciiName : `${asciiName}.pdf`;

  const removeTheme = injectPdfSafeTheme(element);

  // 레이아웃 안정화 대기
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8; // mm — 상하좌우 여백
  const gap = 4;    // mm — 섹션 사이 간격
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  // 직접 자식 요소(카드/섹션) 목록
  const sections = Array.from(element.children) as HTMLElement[];

  let currentY = margin;
  let isFirstSection = true;

  try {
    for (const section of sections) {
      let canvas: HTMLCanvasElement;
      try {
        canvas = await captureWithFallback(section);
      } catch (err) {
        console.error("Section capture failed, skipping:", err);
        continue;
      }

      if (canvas.width === 0 || canvas.height === 0) continue;

      // 캔버스 높이를 PDF mm 단위로 변환
      const sectionH = (canvas.height * usableWidth) / canvas.width;
      const imgData = canvasToJpegDataUrl(canvas);
      const fmt = imgData.startsWith("data:image/png") ? "PNG" : "JPEG";

      if (sectionH > usableHeight) {
        // ── 섹션 자체가 A4보다 높음: 슬라이스 방식 ──
        // 이전 섹션이 있었다면 새 페이지에서 시작
        if (!isFirstSection) {
          pdf.addPage();
          currentY = margin;
        }

        let sliceStartMm = 0;
        while (sliceStartMm < sectionH) {
          if (sliceStartMm > 0) {
            pdf.addPage();
          }
          // 전체 이미지를 올려놓되 음수 offset으로 이전 슬라이스 숨김
          pdf.addImage(
            imgData, fmt,
            margin, margin - sliceStartMm,
            usableWidth, sectionH
          );
          sliceStartMm += usableHeight;
        }

        // 마지막 슬라이스에서 y 커서 계산
        const lastSliceH = sectionH % usableHeight;
        currentY = margin + (lastSliceH > 0 ? lastSliceH : usableHeight);
      } else {
        // ── 일반 섹션: 현재 페이지에 맞으면 이어 붙이고 아니면 새 페이지 ──
        const requiredY = isFirstSection ? currentY + sectionH : currentY + gap + sectionH;

        if (!isFirstSection && requiredY > pageHeight - margin) {
          pdf.addPage();
          currentY = margin;
          pdf.addImage(imgData, fmt, margin, currentY, usableWidth, sectionH);
          currentY += sectionH;
        } else {
          if (!isFirstSection) currentY += gap;
          pdf.addImage(imgData, fmt, margin, currentY, usableWidth, sectionH);
          currentY += sectionH;
        }
      }

      isFirstSection = false;
    }
  } finally {
    removeTheme();
  }

  pdf.save(safeName);
}
