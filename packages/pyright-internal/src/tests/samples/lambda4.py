# This sample tests the case where a lambda is assigned to
# a union type that contains multiple callables.

from typing import Callable, Generic, Protocol, Self, TypeVar, assert_type


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


class KeywordOnlyCallable:
    def __call__(self, *, kwarg: int) -> Self: ...


keyword_only_union: Callable[[KeywordOnlyCallable], KeywordOnlyCallable] | KeywordOnlyCallable = lambda x: x


class GenericKeywordOnlyCallable(Generic[T]):
    def __call__(self, *, kwarg: T) -> Self: ...


generic_keyword_only_union: (
    Callable[[GenericKeywordOnlyCallable[int]], GenericKeywordOnlyCallable[int]] | GenericKeywordOnlyCallable[int]
) = lambda x: x


class KeywordOnlyCallback(Protocol):
    def __call__(self, *, value: int) -> Self: ...


protocol_keyword_only_union: Callable[[KeywordOnlyCallback], KeywordOnlyCallback] | KeywordOnlyCallback = lambda x: x

ordinary_callable_union: Callable[[int], int] | Callable[[str], str] = lambda x: x


class PositionalCallable:
    def __call__(self, value: int) -> Self: ...


positional_callable_union: Callable[[PositionalCallable], PositionalCallable] | PositionalCallable = lambda x: x

# This should generate an error.
keyword_only_callback: KeywordOnlyCallback = lambda x: x


class KeywordOnlyIntCallback(Protocol):
    def __call__(self, *, value: int) -> int: ...


same_name_keyword_only_callback: KeywordOnlyIntCallback = lambda value: assert_type(value, int)


class VariadicKeywordOnlyCallback(Protocol):
    def __call__(self, *args: object, value: int) -> int: ...


variadic_keyword_only_callback: VariadicKeywordOnlyCallback = lambda *args, value: assert_type(value, int)

# The bare `*` separator should not consume the contextual parameter index.
bare_keyword_only_callback: KeywordOnlyIntCallback = lambda *, value: assert_type(value, int)

# This should generate an error because the keyword-only parameter name differs.
variadic_keyword_only_callback_different_name: VariadicKeywordOnlyCallback = lambda *args, other: reveal_type(
    other, expected_text="Unknown"
)

# This should generate an error.
position_only_keyword_callback: KeywordOnlyIntCallback = lambda value, /: value
