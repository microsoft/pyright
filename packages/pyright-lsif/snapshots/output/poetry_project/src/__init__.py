import requests
#      ^^^^^^^^ reference requests/

if __name__ == "__main__":
#  ^^^^^^^^ reference  src 0.1 
    r = requests.get("https://google.com")
#   ^ definition  src 0.1 r.
#       ^^^^^^^^ reference 
#                ^^^ reference 
    print(r.status_code)
#         ^ reference  src 0.1 r.

