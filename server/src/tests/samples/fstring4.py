# This sample tests nested braces within an f-string.

from typing import Dict


def foo(spam, dictval: Dict):
    print(dictval)
    return "Done"


print(f"{foo(0, {'bar' : 1, 'baz': 2})}")

hello = 200
print(f"({hello} \N{greek capital letter sigma})")
print(f"({hello} \N{GREEK CAPITAL LETTER SIGMA})")
