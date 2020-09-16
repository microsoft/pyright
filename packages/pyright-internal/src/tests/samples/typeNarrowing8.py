# This sample tests the type narrowing logic for
# conditional expression involving assignment expressions
# (walrus operator).

# pyright: strict

from typing import Optional

class C:
    def foo(self):
        pass

def good(b: Optional[C]) -> None:
    a = b
    if a:
        a.foo()

def bad(b: Optional[C]) -> None:
    if c := b:
        c.foo()
        b.foo()


