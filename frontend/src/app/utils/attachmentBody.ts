/**
 * Phase 10.19 — 첨부자료 본문 추출 + 민감정보 자동 마스킹 helper.
 *
 * 추출 정책:
 *  - text/*, .txt, .md, .json, .csv → FileReader.readAsText (utf-8)
 *  - application/json, application/csv → 동일하게 텍스트 처리
 *  - .pdf, .docx → 본문 추출 미구현 (TODO). 메타데이터만 반환.
 *
 * 보안 정책:
 *  - 본문은 최대 MAX_BYTES (기본 8KB) 까지만 읽고, 더 길면 truncated=true.
 *  - 마스킹 대상: 주민등록번호, 신용카드, 계좌번호 후보, API key 후보, Bearer token, 이메일+PW 패턴.
 *  - 마스킹 후에도 sensitivityFlags 에 어떤 종류가 발견됐는지 기록.
 *  - 콘솔/로그에는 본문 일부만 흘리지 말 것. (호출 측에서 조심)
 */

export interface ExtractedAttachment {
  /** 원본 File reference (서버 업로드 흐름 추가 시 필요) */
  file: File;
  name: string;
  size: number;
  mimeType: string;
  /** 추출된 본문 텍스트 (마스킹 적용 후). 추출 불가/스킵 시 undefined */
  bodyText?: string;
  /** 본문이 잘렸는지 — true 면 LLM 에게 “일부만 전달됨” 안내 권장 */
  bodyTruncated: boolean;
  /** 추출 실패/스킵 사유 — 사용자에게 “메타데이터만 전달” 등 명확히 안내하기 위함 */
  extractionStatus:
    | "ok"
    | "skipped-unsupported"
    | "skipped-too-large"
    | "error"
    // Phase 10.51 — PDF/DOCX 는 client 에서 base64 만 준비, 실제 텍스트 추출은 서버에서.
    //   client 단계 상태: "pending-server-extract" (서버 도착 후 extracted/partial/failed 로 갱신)
    | "pending-server-extract";
  /** PDF/DOCX 등 바이너리 파일을 서버에서 텍스트 추출하기 위한 base64 본문. 텍스트 파일이면 undefined. */
  bodyBase64?: string;
  /** 발견된 민감정보 패턴 종류 — UI 경고 표시용 */
  sensitivityFlags: string[];
  /** 사용자 입력 카테고리 (선택) */
  category?: string;
  /** 사용자 입력 짧은 설명 (선택) */
  description?: string;
}

const MAX_BYTES = 8 * 1024;          // 본문 추출 최대 8KB / 파일 (텍스트)
const MAX_TOTAL_BYTES = 32 * 1024;   // 전체 합계 최대 32KB (텍스트)
// Phase 10.51 — PDF/DOCX 는 base64 로 서버에 전달 후 서버에서 텍스트 추출.
//   원본 바이너리 크기 제한 — 파일별 1MB, 전체 4MB.
const BIN_PER_FILE_MAX_BYTES = 1 * 1024 * 1024;
const BIN_TOTAL_MAX_BYTES = 4 * 1024 * 1024;
const TEXT_EXT = [".txt", ".md", ".json", ".csv", ".log", ".yaml", ".yml"];

function isTextLike(file: File): boolean {
  if (file.type && file.type.startsWith("text/")) return true;
  if (file.type === "application/json") return true;
  if (file.type === "application/x-yaml") return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXT.some((ext) => lower.endsWith(ext));
}

function isStructuredButUnsupported(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".hwp") ||
    lower.endsWith(".hwpx") ||
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

/**
 * 민감정보 패턴을 마스킹한다. 발견된 카테고리 목록도 함께 반환.
 * - 주민등록번호: 6자리-7자리 → 6자리-*******
 * - 신용카드 16자리 → ****-****-****-마지막4
 * - 계좌번호 후보 (10~14자리 연속숫자) → ******마지막4
 * - API key 후보 (sk_/AKIA/AIza 등으로 시작하는 영문/숫자 20자 이상) → 앞4 + ***
 * - Bearer token (Bearer 다음 영숫자 20자+)
 * - email:password 패턴
 */
export function maskSensitive(text: string): { masked: string; flags: string[] } {
  const flags = new Set<string>();
  let out = text;

  // 주민등록번호 6자리-7자리
  out = out.replace(/(\d{6})[-\s]?(\d{7})/g, (_m, p1) => {
    flags.add("RRN");
    return `${p1}-*******`;
  });

  // 신용카드 16자리
  out = out.replace(/\b(\d{4})[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g, (_m, _p1, p2) => {
    flags.add("CARD");
    return `****-****-****-${p2}`;
  });

  // API key 후보 — sk_ / AKIA / AIza / ghp_ / xoxb- 등
  out = out.replace(
    /\b((?:sk|pk)_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z\-_]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    (m) => {
      flags.add("API_KEY");
      return m.slice(0, 4) + "***" + m.slice(-2);
    },
  );

  // Bearer token
  out = out.replace(/\b(Bearer\s+)([A-Za-z0-9\-_.=]{20,})/g, (_m, p1, p2) => {
    flags.add("BEARER");
    return `${p1}${p2.slice(0, 4)}***`;
  });

  // 계좌번호 후보 — 10~14자리 연속 숫자 (이미 위에서 안 잡힌 것)
  out = out.replace(/\b(\d{10,14})\b/g, (m) => {
    flags.add("ACCOUNT_LIKE");
    return "******" + m.slice(-4);
  });

  // 이메일:비밀번호 패턴
  out = out.replace(/([\w.+-]+@[\w-]+\.[\w.-]+)\s*[:=]\s*\S{4,}/g, (_m, p1) => {
    flags.add("EMAIL_PW");
    return `${p1}:***`;
  });

  return { masked: out, flags: Array.from(flags) };
}

async function readFileAsText(file: File, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  // 파일을 byte 단위로 자른 뒤 디코드 (UTF-8 가정).
  const slice = file.slice(0, maxBytes);
  const buf = await slice.arrayBuffer();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(buf);
  return { text, truncated: file.size > maxBytes };
}

/**
 * 여러 파일에서 본문/메타데이터를 추출한다.
 * 호출 측은 결과를 그대로 payload.attachments 로 직렬화하면 됨.
 */
async function readFileAsBase64(file: File, maxBytes: number): Promise<string | null> {
  if (file.size > maxBytes) return null;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  // chunked to avoid stack overflow
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function extractAttachments(files: File[]): Promise<ExtractedAttachment[]> {
  const out: ExtractedAttachment[] = [];
  let totalBytes = 0;
  let totalBinBytes = 0;

  for (const file of files) {
    const base: ExtractedAttachment = {
      file,
      name: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      bodyTruncated: false,
      extractionStatus: "skipped-unsupported",
      sensitivityFlags: [],
    };

    if (isStructuredButUnsupported(file)) {
      // Phase 10.51 — PDF/DOCX 는 base64 로 서버에 전달.
      // 파일별 1MB / 전체 4MB 한도. 초과 시 메타데이터만.
      const lower = file.name.toLowerCase();
      const isPdfOrDocx = lower.endsWith(".pdf") || lower.endsWith(".docx")
        || file.type === "application/pdf"
        || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (isPdfOrDocx
          && file.size <= BIN_PER_FILE_MAX_BYTES
          && (totalBinBytes + file.size) <= BIN_TOTAL_MAX_BYTES) {
        try {
          const b64 = await readFileAsBase64(file, BIN_PER_FILE_MAX_BYTES);
          if (b64) {
            base.bodyBase64 = b64;
            base.extractionStatus = "pending-server-extract";
            totalBinBytes += file.size;
            out.push(base);
            continue;
          }
        } catch {
          // base64 인코딩 실패 → 메타만
        }
      }
      base.extractionStatus = "skipped-unsupported";
      out.push(base);
      continue;
    }

    if (!isTextLike(file)) {
      base.extractionStatus = "skipped-unsupported";
      out.push(base);
      continue;
    }

    // 전체 합계 초과 시 본문 추출 스킵 (메타만 유지)
    if (totalBytes >= MAX_TOTAL_BYTES) {
      base.extractionStatus = "skipped-too-large";
      out.push(base);
      continue;
    }

    try {
      const allowance = Math.min(MAX_BYTES, MAX_TOTAL_BYTES - totalBytes);
      const { text, truncated } = await readFileAsText(file, allowance);
      const { masked, flags } = maskSensitive(text);
      base.bodyText = masked;
      base.bodyTruncated = truncated;
      base.extractionStatus = "ok";
      base.sensitivityFlags = flags;
      totalBytes += new Blob([masked]).size;
    } catch (e) {
      // 추출 실패 — 메타만 유지. 콘솔에는 파일명만 출력 (본문 미노출)
      console.warn("[attachment] 본문 추출 실패:", file.name);
      base.extractionStatus = "error";
    }
    out.push(base);
  }

  return out;
}

/**
 * payload 직렬화 — File 객체는 제외하고 metadata + bodyText 만 남긴다.
 */
export function attachmentsToPayload(items: ExtractedAttachment[]): Array<Record<string, unknown>> {
  return items.map((it) => ({
    name: it.name,
    size: it.size,
    mimeType: it.mimeType,
    uploadedAt: new Date().toISOString(),
    extractionStatus: it.extractionStatus,
    bodyTruncated: it.bodyTruncated,
    sensitivityFlags: it.sensitivityFlags,
    ...(it.bodyText ? { bodyText: it.bodyText } : {}),
    // Phase 10.51 — PDF/DOCX base64 본문은 서버에서 추출. 응답/DB 에는 저장하지 않음.
    ...(it.bodyBase64 ? { bodyBase64: it.bodyBase64 } : {}),
    ...(it.category ? { category: it.category } : {}),
    ...(it.description ? { description: it.description } : {}),
  }));
}
