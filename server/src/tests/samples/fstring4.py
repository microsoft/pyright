# This sample tests nested braces within an f-string.

from typing import Dict


def foo(spam, dictval: Dict):
    print(dictval)
    return "Done"


print(f"{foo(0, {'bar' : 1, 'baz': 2})}")
