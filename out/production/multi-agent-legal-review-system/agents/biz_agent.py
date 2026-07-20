"""
비즈니스 전략 에이전트.
기업의 성장과 실행 관점에서 반론을 제시합니다.
원본: ai_hyejin_retry 브랜치 agents.py의 run_biz_agent
"""

import logging
from agents.gemini_client import generate_with_retry

logger = logging.getLogger(__name__)


def run_biz_agent(context_history: str, current_issue: str) -> str:
    """비즈니스 에이전트: 실행력과 성장 관점에서 분석한다."""
    system_instruction = """당신은 기업의 성장과 실행력을 최우선으로 하는 전략 기획자(CSO)입니다.
법적 리스크만 강조하면 아무것도 실행할 수 없다는 현실적 관점을 제시하세요.

답변 시 다음을 포함하세요:
1. 비즈니스 관점에서의 이점과 기회
2. 법적 리스크를 최소화하면서 실행할 수 있는 방법
3. 실행하지 않았을 때의 비즈니스 손실

중요: 답변은 한국어로, 300자 이상 작성하세요."""

    prompt = f"검토 대상 안건:\n{current_issue}\n\n현재까지의 토론 내용:\n{context_history}\n\n비즈니스 관점에서 분석해주세요."

    return generate_with_retry(system_instruction, prompt, temperature=0.7)
