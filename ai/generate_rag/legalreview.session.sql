select count(*)
from law_documents;
--where reference_id ='268809';
--where law_id = '010162';


--TRUNCATE TABLE public.law_documents RESTART IDENTITY;

--테이블 구조 확인
--SELECT column_name, data_type, character_maximum_length, is_nullable
--FROM information_schema.columns
--WHERE table_name = 'law_documents'
--ORDER BY ordinal_position;


--SELECT law_id, COUNT(*) AS cnt
--FROM law_list
--GROUP BY law_id
--HAVING COUNT(*) > 1
--ORDER BY cnt DESC;

--law_status = 3 5453개 확인 / law_status = 2 841 개  .. 시행예정법령에서 mst가 겹치는 게 있음. 확인해봐야함

