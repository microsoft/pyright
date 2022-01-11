import requests

if __name__ == "__main__":
    r = requests.get("https://google.com")
    print(r.status_code)
