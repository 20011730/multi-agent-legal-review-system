import xml.etree.ElementTree as ET
import re
import html
import json
from pathlib import Path
from datetime import datetime

INPUT_DIR = "./tmp/precedents"
OUTPUT_DIR = "./tmp/parsed_cases"

def clean_text(text: str | None) -> str:
    """XML CDATA 내부의 HTML 태그 및 공백 정제"""
    if not text:
        return ""
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = html.unescape(text)
    text = text.strip()
    return text

def parse_xml_to_dict(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    
    reference_id = root.findtext("판례정보일련번호", default="").strip()
    
    return {
        "referenceId": reference_id,
        "title": root.findtext("사건명", default="").strip(),
        "caseNumber": root.findtext("사건번호", default="").strip(),
        "judgmentDate": root.findtext("선고일자", default="").strip(),
        "judgment": root.findtext("선고", default="").strip(),
        "court": root.findtext("법원명", default="").strip(),
        "caseType": root.findtext("사건종류명", default="").strip(),
        "url": f"https://www.law.go.kr/precInfoP.do?precSeq={reference_id}",
        "prectype": root.findtext("판결유형", default="").strip(),
        
        # 텍스트 섹션 데이터 가공 및 1:1 매핑
        "issues": clean_text(root.findtext("판시사항")),
        "summary": clean_text(root.findtext("판결요지")),
        "referencedProvisions": clean_text(root.findtext("참조조문")),  # 추가됨
        "referencedPrecedents": clean_text(root.findtext("참조판례")),    # 추가됨
        "rawcontent": clean_text(root.findtext("판례내용")),
        
        "chunked": False,
        "createdAt": datetime.now().isoformat(),
        "updatedAt": None
    }

def main():
    in_dir = Path(INPUT_DIR)
    out_dir = Path(OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    xml_files = list(in_dir.glob("*.xml"))
    if not xml_files:
        print(f"[{INPUT_DIR}] 디렉토리에 XML 파일이 없습니다.")
        return
        
    print(f"총 {len(xml_files)}개의 XML 파일을 참조조문/참조판례 필드를 포함하여 매핑합니다...")
    
    parsed_cases = []
    for file in xml_files:
        try:
            xml_text = file.read_text(encoding="utf-8")
            case_dict = parse_xml_to_dict(xml_text)
            parsed_cases.append(case_dict)
        except Exception as e:
            print(f"파일 파싱 에러 ({file.name}): {e}")

    output_file = out_dir / "cases_raw_parsed.json"
    with output_file.open("w", encoding="utf-8") as f:
        json.dump(parsed_cases, f, ensure_ascii=False, indent=2)

    print("=" * 70)
    print(f"변환 완료! 결과물 저장 위치: {output_file.resolve()}")
    print(f"총 추출 건수: {len(parsed_cases)}건")
    print("=" * 70)

if __name__ == "__main__":
    main()