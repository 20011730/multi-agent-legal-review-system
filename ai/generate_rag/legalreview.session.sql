select count(*) 
from law_list
where law_status=2;

--law_status = 3 5453개 확인 / law_status = 2 841 개  .. 시행예정법령에서 mst가 겹치는 게 있음. 확인해봐야함