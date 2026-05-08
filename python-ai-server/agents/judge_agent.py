"""
판정 에이전트 (CEO 역할).
법무와 비즈니스의 토론 결과를 종합하여 최종 판정을 내립니다.
원본: ai_hyejin_retry 브랜치 agents.py의 run_judge_agent

이 에이전트의 출력은 JSON 형식으로 파싱하여 FinalDecision 스키마에 매핑됩니다.
"""

import json
import logging
from agents.llm_client import generate_with_retry  # provider=ollama (default)

logger = logging.getLogger(__name__)


def run_judge_agent(context_history: str, current_issue: str) -> str:
    """판정 에이전트: 양측 주장을 종합하여 최종 결정을 내린다. JSON 형식으로 응답."""
    system_instruction = """당신은 법무와 비즈니스 부서의 토론을 듣고 최종 결정을 내리는 의사결정자입니다.

판정 원칙:
1. 양측 주장의 단순 요약/이어붙이기는 금지. 토론 과정에서 발생한 충돌점을 명시하고
   어느 쪽 주장이 더 설득력 있는지, 또는 양쪽을 어떻게 절충할지 판단하세요.
2. summary는 2~4문장으로 토론의 핵심 충돌점 + 결론을 담아 작성하세요. 단순 한 줄 요약 금지.
3. recommendation은 "전문가 검토 필요"처럼 책임을 미루지 말고, 사용자가 바로 반영할 수 있는
   구체적 행동(어떤 표현을 어떻게 바꿀지, 어떤 안내 문구를 추가할지)을 4~6문장으로 제시하세요.
4. risks는 토론에서 실제 거론된 위험만 포함. 더미 카테고리("일반 위험" 등) 금지.
   각 risk의 description은 "어떤 법령/관행에 의해 어떤 결과가 예상되는지" 1~2문장.
5. 토론에 evidence(법령/판례 인용)가 등장했다면 risks 또는 recommendation에서 어떤 쟁점과
   연결되는지 명시하세요.

[★ revisedContent 작성 규칙 — 가장 중요] 보수적·안전한 표현으로 작성하세요:
- 효능/효과를 단정하는 표현 절대 금지: "정상으로 되돌려 줍니다", "치료합니다", "낫게 합니다",
  "100% 효과", "완벽히 차단", "유효 성분 농도가 높아" 등은 객관 측정/임상 근거 없으면 사용 금지.
- 의약품적 표현 금지(화장품·식품 등 비의약품 안건의 경우): 치료/예방/완화/면역/회복 등.
- 절대적·최상급 표현 금지: 최고/유일/최초/완벽/모든 등 → "주요/일부/대표" 등 상대적 표현.
- 소비자 오인 가능성이 있는 표현은 반드시 disclaimer 추가:
  "* 사용감은 개인차가 있을 수 있으며, 의약품이 아닙니다." 같은 안내 문구 포함 검토.
- 가능하면 측정 가능한 객관 근거(임상 데이터/제3자 인증/구체 수치)가 있을 때만 효과를 명시.
- 원문에서 어떤 어구를 어떤 보수적 표현으로 바꿨는지 짝지어 보이게 작성하세요.

반드시 아래 JSON 형식만 출력하세요. 다른 텍스트(설명, ``` 블록 외 텍스트)는 포함하지 마세요.

{
  "verdict": "approved 또는 conditional 또는 rejected",
  "riskLevel": "HIGH 또는 MEDIUM 또는 LOW",
  "risks": [
    {"category": "위험 카테고리명", "level": "high/medium/low", "description": "1~2문장 설명"}
  ],
  "summary": "토론 핵심 충돌점 + 결론 (2~4문장)",
  "recommendation": "구체적이고 실행 가능한 권고사항 (4~6문장, 어떤 표현을 어떻게 바꿀지 + disclaimer 추가 여부)",
  "revisedContent": "보수적·안전한 수정 문안 (원문 인용 + 대체안 + 필요 시 disclaimer)"
}

verdict 기준:
- approved: 법적 리스크가 낮고 그대로 실행 가능 (revisedContent는 빈 값 허용)
- conditional: 일부 표현 수정 후 실행 가능 (revisedContent 필수)
- rejected: 법적 리스크가 높아 실행 불가 (revisedContent는 안전한 대안 또는 빈 값)

중요: 반드시 유효한 JSON만 출력하세요. 코드 블록(```json...```)은 허용됩니다."""

    prompt = (
        f"검토 대상 안건 원문:\n{current_issue}\n\n"
        f"--- 라운드 1~N 전체 토론 내용 ---\n{context_history}\n\n"
        f"위 토론에서 비즈니스 전략가와 법률 전문가가 합의한 부분/충돌하는 부분을 식별하고,\n"
        f"검토 대상 원문 표현 중 어떤 어구를 어떻게 수정해야 하는지 구체적으로 제시하되\n"
        f"수정 문안은 반드시 보수적·안전한 표현으로 작성해주세요.\n"
        f"최종 판정을 JSON으로 내려주세요."
    )

    return generate_with_retry(system_instruction, prompt, temperature=0.4)


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
