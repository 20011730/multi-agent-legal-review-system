select *
from case_documents
limit 10;
--ALTER TABLE case_documents ALTER COLUMN case_number TYPE TEXT;
--ALTER TABLE case_documents ALTER COLUMN case_type TYPE TEXT;
--TRUNCATE TABLE case_documents RESTART IDENTITY CASCADE;
--DROP TABLE IF EXISTS case_documents CASCADE; --테이블 삭제 
--where data_source = '지방세법령정보시스템'
--;

--where judgment is not null;
--where case_no = '2021도1533';

-- 226943 / 234437  / 221765

--group by judgment_type;
--where reference_id ='268809';
--where law_id = '010162';


--TRUNCATE TABLE public.law_documents RESTART IDENTITY;

--테이블 구조 확인
--SELECT column_name, data_type, character_maximum_length, is_nullable
--FROM information_schema.columns
--WHERE table_name = 'precedent_list'
--ORDER BY ordinal_position;


--SELECT law_id, COUNT(*) AS cnt
--FROM law_list
--GROUP BY law_id
--HAVING COUNT(*) > 1
--ORDER BY cnt DESC;

--law_status = 3 5453개 확인 / law_status = 2 841 개  .. 시행예정법령에서 mst가 겹치는 게 있음. 확인해봐야함

