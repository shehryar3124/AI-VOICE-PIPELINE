import requests

API_KEY = "25765da67c465dc56cfb33f291ece76c6a200bc5"  # 🔥 replace this

res = requests.get(
    "https://api.deepgram.com/v1/projects",
    headers={"Authorization": f"Token {API_KEY}"}
)

print("Status Code:", res.status_code)
print("Response:", res.text)