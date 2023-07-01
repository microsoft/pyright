# This sample tests nested braces within an f-string.


def foo(spam, dictval: dict):
    print(dictval)
    return "Done"


print(f"{foo(0, {'bar' : 1, 'baz': 2})}")

hello = 200
print(f"({hello} \N{greek capital letter sigma})")
print(f"({hello} \N{GREEK   CAPITAL     LETTER  SIGMA})")
print(f"({hello} \N{VARIATION SELECTOR-16})")
print(f"({hello} \N{VARIATION SELECTOR-16})")
