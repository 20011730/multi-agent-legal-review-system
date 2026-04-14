"""
판정 에이전트 (CEO 역할).
법무와 비즈니스의 토론 결과를 종합하여 최종 판정을 내립니다.
원본: ai_hyejin_retry 브랜치 agents.py의 run_judge_agent

이 에이전트의 출력은 JSON 형식으로 파싱하여 FinalDecision 스키마에 매핑됩니다.
"""

import json
import logging
from agents.gemini_client import generate_with_retry

logger = logging.getLogger(__name__)


def run_judge_agent(context_history: str, current_issue: str) -> str:
    """판정 에이전트: 양측 주장을 종합하여 최종 결정을 내린다. JSON 형식으로 응답."""
    system_instruction = """당신은 법무와 비즈니스 부서의 토론을 듣고 최종 결정을 내리는 CEO입니다.

양측의 주장을 객관적으로 평가하고, 아래 JSON 형식으로 최종 판정을 출력하세요.
반드시 아래 JSON 형식만 출력하세요. 다른 텍스트는 포함하지 마세요.

{
  "verdict": "approved 또는 conditional 또는 rejected",
  "riskLevel": "HIGH 또는 MEDIUM 또는 LOW",
  "risks": [
    {"category": "위험 카테고리명", "level": "high/medium/low", "description": "설명"}
  ],
  "summary": "전체 판정 요약 (2-3문장)",
  "recommendation": "구체적 권고사항",
  "revisedContent": "수정 제안 문구 (해당 없으면 빈 문자열)"
}

verdict 기준:
- approved: 법적 리스크가 낮고 실행 가능
- conditional: 일부 수정 후 실행 가능
- rejected: 법적 리스크가 높아 실행 불가

중요: 반드시 유효한 JSON만 출력하세요."""

    prompt = f"검토 대상 안건:\n{current_issue}\n\n전체 토론 내용:\n{context_history}\n\n최종 판정을 JSON으로 내려주세요."

    return generate_with_retry(system_instruction, prompt, temperature=0.5)


def parse_judge_response(raw_text: str) -> dict:
    """판정 에이전트의 JSON 응답을 파싱한다. 실패 시 기본값을 반환."""
    try:
        # ```json ... ``` 블록 추출
        text = raw_text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        result = json.loads(text)

        # 필수 필드 검증
        required = ["verdict", "riskLevel", "summary", "recommendation"]
        for field in required:
            if field not in result:
                raise ValueError(f"필수 필드 누락: {field}")

        # verdict 값 정규화
        verdict = result["verdict"].lower().strip()
        if verdict not in ("approved", "conditional", "rejected"):
            verdict = "conditional"
        result["verdict"] = verdict

        # riskLevel 정규화
        risk = result["riskLevel"].upper().strip()
        if risk not in ("HIGH", "MEDIUM", "LOW"):
            risk = "MEDIUM"
        result["riskLevel"] = risk

        # risks 기본값
        if "risks" not in result or not isinstance(result["risks"], list):
            result["risks"] = []

        # revisedContent 기본값
        if "revisedContent" not in result:
            result["revisedContent"] = ""

        return result

    except Exception as e:
        logger.error("판정 JSON 파싱 실패: %s — 기본 판정을 생성합니다. 원문: %s", e, raw_text[:200])
        return {
            "verdict": "conditional",
            "riskLevel": "MEDIUM",
            "risks": [
                {"category": "파싱 오류", "level": "medium", "description": "AI 판정 결과 파싱에 실패하여 기본 판정이 적용되었습니다."}
            ],
            "summary": f"AI 판정 원문: {raw_text[:300]}",
            "recommendation": "AI 판정 결과를 직접 검토해주세요.",
            "revisedContent": "",
        }
