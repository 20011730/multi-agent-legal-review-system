"""
Phase 10.51 — PDF / DOCX 첨부 본문 추출.

Frontend 가 PDF/DOCX 파일을 base64 로 보내면 (선택 필드 `bodyBase64`),
여기서 디코딩 → pypdf / python-docx 로 텍스트 추출 → bodyText 채움.
민감정보 마스킹은 frontend 측 maskSensitive 가 이미 텍스트 파일에 적용함.
PDF/DOCX 도 동일 패턴으로 추가 마스킹.

길이 제한:
  파일별 추출 텍스트 최대 8000 자
  전체 첨부자료 본문 합계 최대 20000 자
"""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

PER_FILE_MAX_CHARS = 8000
TOTAL_MAX_CHARS = 20000
# Phase 10.54 — 문서 원본 추출 한도 (LLM 컨텍스트 제한과 별개로 우선 크게 읽고, 키워드 기반 선별).
RAW_EXTRACT_MAX_CHARS = 60000
RAW_EXTRACT_MAX_PAGES = 200

# Phase 10.54 — 핵심 검토 키워드. 첨부 본문이 PER_FILE_MAX_CHARS 를 초과할 때
# 단순 앞부분 자르기 대신, 이 키워드가 포함된 문단을 우선 선별해 prompt 에 담는다.
PRIORITY_KEYWORDS = [
    "정산", "환수", "중복 수혜", "협약", "사업비", "지식재산권", "지식재산", "IP",
    "성과물", "개인정보", "제3자 제공", "위탁", "외주", "고용", "근로자", "프리랜서",
    "표시광고", "표시·광고", "홍보", "손해배상", "해지", "계약 위반", "비밀유지",
    "데이터", "저작권", "특허", "상표", "결격사유", "환수 사유", "목적외",
]


def select_priority_paragraphs(text: str, limit: int) -> tuple[str, list[str], int]:
    """
    문단(빈 줄/개행 기준) 단위로 분할한 뒤, PRIORITY_KEYWORDS 가 포함된 문단을 우선 채택해
    `limit` 글자에 맞춰 컨텍스트를 구성한다.
    반환: (selected_text, matched_keywords, paragraph_count)

    전략:
      1) 문단 분할 (이중 개행 우선, 부족하면 단일 개행)
      2) 각 문단의 키워드 매칭 점수 계산 (포함된 키워드 갯수)
      3) 점수 > 0 문단을 점수 내림차순, 길이는 충분히 자르기로 채워 limit 내에 담는다
      4) 남은 limit 이 있으면 score 0 문단(앞부분 우선)으로 보충
    """
    if not text or limit <= 0:
        return ("", [], 0)
    # 문단 분리
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(paras) <= 1:
        paras = [p.strip() for p in text.split("\n") if p.strip()]
    if not paras:
        return (text[:limit], [], 1)

    scored: list[tuple[int, int, str, list[str]]] = []  # (score, idx, text, matched_kws)
    for idx, p in enumerate(paras):
        kws = [k for k in PRIORITY_KEYWORDS if k in p]
        scored.append((len(kws), idx, p, kws))

    # 점수 내림차순 + 문서 순서 유지 (안정 정렬)
    priority = sorted(
        [s for s in scored if s[0] > 0],
        key=lambda x: (-x[0], x[1]),
    )
    rest = [s for s in scored if s[0] == 0]

    out_chunks: list[tuple[int, str]] = []  # (original_idx, text)
    used = 0
    matched_kws: set[str] = set()

    def _add(idx: int, p: str) -> bool:
        nonlocal used
        if used >= limit:
            return False
        remaining = limit - used
        chunk = p if len(p) <= remaining else p[:remaining]
        out_chunks.append((idx, chunk))
        used += len(chunk) + 2  # +2 for join newline
        return used < limit

    for score, idx, p, kws in priority:
        matched_kws.update(kws)
        if not _add(idx, p):
            break
    if used < limit:
        for score, idx, p, kws in rest:
            if not _add(idx, p):
                break

    # 원래 문서 순서로 재정렬하여 출력 (가독성)
    out_chunks.sort(key=lambda x: x[0])
    selected = "\n\n".join(c[1] for c in out_chunks)
    return (selected, sorted(matched_kws), len(out_chunks))


# 간단 민감정보 마스킹 (frontend maskSensitive 와 동일 패턴 — best effort)
_RRN = re.compile(r"(\d{6})[-\s]?\d{7}")
_CARD = re.compile(r"\b(\d{4})[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b")
_API = re.compile(
    r"\b(?:sk|pk)_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z\-_]{16,}"
    r"|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}"
)
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9\-_.=]{20,}")
_ACCOUNT = re.compile(r"\b\d{10,14}\b")
_EMAIL_PW = re.compile(r"([\w.+\-]+@[\w-]+\.[\w.-]+)\s*[:=]\s*\S{4,}")


def _mask(text: str) -> tuple[str, list[str]]:
    flags: set[str] = set()

    def _rrn(m: re.Match[str]) -> str:
        flags.add("RRN")
        return f"{m.group(1)}-*******"

    def _card(m: re.Match[str]) -> str:
        flags.add("CARD")
        return f"****-****-****-{m.group(2)}"

    def _api(m: re.Match[str]) -> str:
        flags.add("API_KEY")
        s = m.group(0)
        return s[:4] + "***" + s[-2:]

    def _bearer(m: re.Match[str]) -> str:
        flags.add("BEARER")
        s = m.group(0)
        return s[:11] + "***"

    def _account(m: re.Match[str]) -> str:
        flags.add("ACCOUNT_LIKE")
        s = m.group(0)
        return "******" + s[-4:]

    def _emailpw(m: re.Match[str]) -> str:
        flags.add("EMAIL_PW")
        return f"{m.group(1)}:***"

    out = text
    out = _RRN.sub(_rrn, out)
    out = _CARD.sub(_card, out)
    out = _API.sub(_api, out)
    out = _BEARER.sub(_bearer, out)
    out = _ACCOUNT.sub(_account, out)
    out = _EMAIL_PW.sub(_emailpw, out)
    return out, sorted(flags)


def _is_pdf(att: dict[str, Any]) -> bool:
    name = (att.get("name") or "").lower()
    mime = (att.get("mimeType") or att.get("type") or "").lower()
    return name.endswith(".pdf") or mime == "application/pdf"


def _is_docx(att: dict[str, Any]) -> bool:
    name = (att.get("name") or "").lower()
    mime = (att.get("mimeType") or att.get("type") or "").lower()
    return name.endswith(".docx") or mime == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


def _extract_pdf_text(data: bytes) -> str:
    """PDF 텍스트 레이어를 읽는다. 실패하거나 텍스트가 거의 없으면 빈 문자열을 반환한다."""
    try:
        from pypdf import PdfReader
    except Exception as e:
        logger.warning("[attach-extract] pypdf 미설치: %s", e)
        return ""
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as e:
        logger.warning("[attach-extract] PDF 파싱 실패 — 손상/비표준 파일 가능성: %s", type(e).__name__)
        return ""
    parts: list[str] = []
    try:
        # Phase 10.54 — 더 많은 페이지를 읽고 (RAW_EXTRACT_MAX_PAGES) 키워드 기반 선별은 호출 측에서.
        for page in reader.pages[:RAW_EXTRACT_MAX_PAGES]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
            if sum(len(p) for p in parts) >= RAW_EXTRACT_MAX_CHARS:
                break
    except Exception as e:
        logger.warning("[attach-extract] PDF 페이지 순회 실패: %s", type(e).__name__)
    text = "\n\n".join(parts).strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def _iter_docx_blocks(doc: Any) -> list[str]:
    parts: list[str] = []
    try:
        from docx.table import Table  # type: ignore
        from docx.text.paragraph import Paragraph  # type: ignore
    except Exception:
        return parts

    for child in doc.element.body.iterchildren():
        tag = str(child.tag)
        if tag.endswith("}p"):
            text = Paragraph(child, doc).text.strip()
            if text:
                parts.append(text)
        elif tag.endswith("}tbl"):
            table = Table(child, doc)
            rows: list[str] = []
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                parts.append("\n".join(rows))
        if sum(len(s) for s in parts) >= RAW_EXTRACT_MAX_CHARS:
            break
    return parts


def _extract_docx_text(data: bytes) -> str:
    """DOCX 문단과 표 텍스트를 가능한 문서 순서대로 읽는다."""
    try:
        from docx import Document  # type: ignore
    except Exception as e:
        logger.warning("[attach-extract] python-docx 미설치: %s", e)
        return ""
    try:
        doc = Document(io.BytesIO(data))
    except Exception as e:
        logger.warning("[attach-extract] DOCX 파싱 실패 — 손상/비표준 파일 가능성: %s", type(e).__name__)
        return ""
    parts: list[str] = []
    try:
        parts = _iter_docx_blocks(doc)
        if not parts:
            for p in doc.paragraphs:
                if p.text:
                    parts.append(p.text)
                if sum(len(s) for s in parts) >= RAW_EXTRACT_MAX_CHARS:
                    break
            for table in doc.tables:
                for row in table.rows:
                    cells = [c.text for c in row.cells if c.text]
                    if cells:
                        parts.append(" | ".join(cells))
                    if sum(len(s) for s in parts) >= RAW_EXTRACT_MAX_CHARS:
                        break
                if sum(len(s) for s in parts) >= RAW_EXTRACT_MAX_CHARS:
                    break
    except Exception as e:
        logger.warning("[attach-extract] DOCX 본문 순회 실패: %s", type(e).__name__)
    text = "\n\n".join(parts).strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def enrich_attachments_with_extracted_text(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    """
    각 첨부 항목을 검사하여 bodyBase64 가 있고 PDF/DOCX 인 경우 본문을 추출해
    bodyText / extractionStatus / characterCount 필드를 추가/갱신한다.

    이미 bodyText 가 있는 항목(텍스트 파일)은 그대로 유지.
    원본 dict 는 변경하지 않고 새 list 반환.
    """
    if not attachments:
        return attachments
    out: list[dict[str, Any]] = []
    total_chars = 0
    for att in attachments:
        if not isinstance(att, dict):
            out.append(att)
            continue
        new = dict(att)
        # 이미 텍스트 추출 완료된 경우 (frontend 텍스트 파일) 통과
        if new.get("bodyText"):
            out.append(new)
            continue
        body_b64 = new.get("bodyBase64") or new.get("contentBase64")
        if not body_b64:
            out.append(new)
            continue
        try:
            data = base64.b64decode(body_b64, validate=False)
        except Exception:
            new["extractionStatus"] = "failed"
            out.append(new)
            continue

        extracted = ""
        kind = ""
        if _is_pdf(new):
            kind = "pdf"
            extracted = _extract_pdf_text(data)
        elif _is_docx(new):
            kind = "docx"
            extracted = _extract_docx_text(data)
        else:
            # 알 수 없는 바이너리 → 그대로 패스
            new["extractionStatus"] = new.get("extractionStatus") or "skipped-unsupported"
            out.append(new)
            continue

        if not extracted or len(extracted.strip()) < 30:
            new["extractionStatus"] = "failed-image-or-empty" if kind == "pdf" else "failed"
            new["fileType"] = kind
            new["characterCount"] = len(extracted.strip())
            # bodyBase64 는 LLM 컨텍스트에 넘기지 않음 → 제거
            new.pop("bodyBase64", None)
            new.pop("contentBase64", None)
            out.append(new)
            continue

        # Phase 10.54 — 길이 제한 적용:
        #   파일별 한도: PER_FILE_MAX_CHARS
        #   전체 한도: TOTAL_MAX_CHARS
        #   초과 시 단순 앞부분 자르기 대신 PRIORITY_KEYWORDS 기반 문단 선별 → 핵심 조항 누락 방지
        per_file_limit = PER_FILE_MAX_CHARS
        remaining_total = TOTAL_MAX_CHARS - total_chars
        if remaining_total <= 0:
            new["extractionStatus"] = "skipped-too-large"
            new["fileType"] = kind
            new.pop("bodyBase64", None)
            new.pop("contentBase64", None)
            out.append(new)
            continue
        limit = min(per_file_limit, remaining_total)
        original_len = len(extracted)
        truncated = False
        matched_kws: list[str] = []
        para_count = 0
        if original_len > limit:
            # 핵심 키워드 기반 문단 선별
            extracted, matched_kws, para_count = select_priority_paragraphs(extracted, limit)
            truncated = True
        else:
            # 한도 내 — 키워드 매칭 정보만 부가
            for k in PRIORITY_KEYWORDS:
                if k in extracted:
                    matched_kws.append(k)
            matched_kws = sorted(set(matched_kws))

        masked, flags = _mask(extracted)
        existing_flags = list(new.get("sensitivityFlags") or [])
        merged_flags = sorted(set(existing_flags + flags))

        new["bodyText"] = masked
        new["bodyTruncated"] = truncated
        new["extractionStatus"] = "partial" if truncated else "extracted"
        new["fileType"] = kind
        new["characterCount"] = len(masked)
        new["originalLength"] = original_len
        # Phase 10.54 — 핵심 검토 키워드와 선별된 문단 수 메타데이터 추가
        new["priorityKeywords"] = matched_kws
        if para_count > 0:
            new["selectedParagraphCount"] = para_count
        new["sensitivityFlags"] = merged_flags
        # 원본 base64 는 LLM/DB 에 넘기지 않음 (용량/보안)
        new.pop("bodyBase64", None)
        new.pop("contentBase64", None)
        total_chars += len(masked)
        out.append(new)
    return out
