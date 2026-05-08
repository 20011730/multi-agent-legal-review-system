import requests

api_url = "https://www.law.go.kr/DRF/lawService.do?OC=hyejin&target=law&type=json&query=민법"
response = requests.get(api_url, timeout=30)

print("status =", response.status_code)
print(response.text)