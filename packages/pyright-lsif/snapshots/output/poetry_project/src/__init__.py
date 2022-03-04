import requests
#      ^^^^^^^^ reference requests/

if __name__ == "__main__":
#  ^^^^^^^^ reference  src 0.0 
    r = requests.get("https://google.com")
#   ^ definition r.
#       ^^^^^^^^ reference 
#                ^^^ reference  requests 2.3 get().
    print(r.status_code)
#   ^^^^^ reference  python 3.9 builtins#print.
#         ^ reference r.
#           ^^^^^^^^^^^ reference  python 3.9 builtins#status_code.

