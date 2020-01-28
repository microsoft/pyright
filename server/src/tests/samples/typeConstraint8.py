# This sample tests the type constraint system when
# conditional expression includes an assignment (walrus)
# operator.

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


