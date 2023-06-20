# This sample tests the type narrowing logic for
# conditional expression involving assignment expressions
# (walrus operator).

# pyright: strict


class C:
    def method1(self):
        pass


def good(b: C | None) -> None:
    a = b
    if a:
        a.method1()


def bad(b: C | None) -> None:
    if c := b:
        c.method1()
        b.method1()
