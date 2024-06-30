# This sample tests the case where a lambda is assigned to
# a union type that contains multiple callables.

from typing import Callable, Protocol, TypeVar


U1 = Callable[[int, str], bool] | Callable[[str], bool]


def accepts_u1(cb: U1) -> U1:
    return cb


def callback_1(p0: int, p1: str):
    return True


def callback_2(p0: str):
    return True


def callback_3(*p0: str):
    return True


accepts_u1(lambda s: s.startswith("hello"))
accepts_u1(lambda i, s: i > 0 and s.startswith("hello"))
accepts_u1(lambda *i: True)
accepts_u1(callback_1)
accepts_u1(callback_2)
accepts_u1(callback_3)

# This should generate an error
accepts_u1(lambda a, b, c: True)


class Callable1(Protocol):
    def __call__(self, p0: int, p1: str) -> bool: ...


class Callable2(Protocol):
    def __call__(self, p0: str) -> bool: ...


class Callable3(Protocol):
    def __call__(self, *p0: str) -> bool: ...


class Callable4(Protocol):
    def __call__(self, p0: int, p1: str, *p2: str) -> bool: ...


U2 = Callable1 | Callable2 | Callable3 | Callable4


def accepts_u2(cb: U2) -> U2:
    return cb


accepts_u2(lambda p0: p0.startswith("hello"))
accepts_u2(lambda p0, p1: p0 > 0 and p1.startswith("hello"))
accepts_u2(lambda *i: True)
accepts_u2(lambda p0, p1, *p2: True)
accepts_u2(callback_1)
accepts_u2(callback_2)
accepts_u2(callback_3)


T = TypeVar("T")

Takes = Callable[[T], object]

U3 = Takes[Takes[int]] | Takes[Takes[str]]


def accepts_u3(u: U3):
    # This should generate an error.
    u(lambda v: v.lower())
