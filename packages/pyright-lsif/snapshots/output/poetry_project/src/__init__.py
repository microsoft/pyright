import requests
#      ^^^^^^^^ reference requests/

if __name__ == "__main__":
    r = requests.get("https://google.com")
#                ^^^ reference  python 3.9 builtins#get.
    print(r.status_code)

