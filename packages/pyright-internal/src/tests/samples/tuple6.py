# This sample tests tuple parameter matching for
# cases where an unpack operator is used in the target.

from typing import Iterable

a: int
b: int
c: str
d: str
e: Iterable[int]
f: Iterable[str | int]

# This should generate an error because an unpack
# operator must be within a tuple.
*e = 3, 4, 5, 6

(*e,) = 3, 4, 5, 6

a, b, *e, c, d = 3, 4, "a", "b"

a, b, *f, c, d = 3, 4, 5, "a", "b", "c"

*f, a, b, c, d = 3, 4, "a", "b"
a, *f, b, c, d = 3, 4, "a", "b"
a, b, *f, c, d = 3, 4, "a", "b"
a, b, c, *f, d = 3, 4, "a", "b"
a, b, c, d, *f = 3, 4, "a", "b"

a, b, c, *f = 3, 2, ""

# This should generate an error because there are
# not enough source values.
*f, a, b, c = 3, 2
a, *f, b, c = 3, 2
a, b, *f, c = 3, 2
a, b, c, *f = 3, 2

# This should generate an error because there are
# too many source values.
a, b = 3, 2, 3

# This should generate an error because e can't
# accommodate both int and str types.
a, b, *e, c, d = 3, 4, 5, "a", "b", "c"


def func1(p1: tuple[str, ...]):
    global a, b, c, d

    c, d = p1

    # This should generate an error because
    # p1 is an incompatible type.
    a, b = p1

    c, d, *f = p1


def func2(p1: tuple[str, ...], p2: tuple[str, *tuple[str, ...]]):
    () = p1
    (_,) = p1
    (_, _) = p1

    # This should generate an error.
    () = p2
    (_,) = p2
