# This file validates type narrowing that involve
# conditional binary expressions.

# pyright: reportOptionalMemberAccess=false

from random import random


class Foo:
    def bar(self):
        return


maybe = True

a = None if maybe else Foo()
b = None if maybe else Foo()

if not a or not b:
    a.bar()
    b.bar()
else:
    a.bar()
    b.bar()

if not (not a or not b):
    a.bar()
    b.bar()
else:
    a.bar()
    b.bar()

if not a and not b:
    # This should be flagged as an error
    a.bar()
    # This should be flagged as an error
    b.bar()
else:
    a.bar()
    b.bar()

if not (not a and not b):
    a.bar()
    b.bar()
else:
    # This should be flagged as an error
    a.bar()
    # This should be flagged as an error
    b.bar()

if a or b:
    a.bar()
    b.bar()
else:
    # This should be flagged as an error
    a.bar()
    # This should be flagged as an error
    b.bar()


def func1(a: str, b: str | bool) -> bool:
    x: str | bool = a and a in []
    reveal_type(x, expected_text="bool | Literal['']")

    if random() > 0.5:
        return (a and a in [""]) or True
    else:
        return x or True
