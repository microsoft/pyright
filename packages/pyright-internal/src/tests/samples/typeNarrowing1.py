# This file validates type narrowing that involve
# conditional binary expressions.

# pyright: reportOptionalMemberAccess=false

from random import random


class ClassA:
    def x(self):
        return


maybe = True

a = None if maybe else ClassA()
b = None if maybe else ClassA()

if not a or not b:
    a.x()
    b.x()
else:
    a.x()
    b.x()

if not (not a or not b):
    a.x()
    b.x()
else:
    a.x()
    b.x()

if not a and not b:
    # This should be flagged as an error
    a.x()
    # This should be flagged as an error
    b.x()
else:
    a.x()
    b.x()

if not (not a and not b):
    a.x()
    b.x()
else:
    # This should be flagged as an error
    a.x()
    # This should be flagged as an error
    b.x()

if a or b:
    a.x()
    b.x()
else:
    # This should be flagged as an error
    a.x()
    # This should be flagged as an error
    b.x()


def func1(a: str, b: str | bool) -> bool:
    x: str | bool = a and a in []
    reveal_type(x, expected_text="bool | Literal['']")

    if random() > 0.5:
        return (a and a in [""]) or True
    else:
        return x or True
