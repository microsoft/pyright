# This sample tests overload argument caches across contextual inference calls.

from typing import Any, TypeVar, overload


class Basic:
    def matches(self, other: "Basic") -> dict[str, int] | None:
        return None


class Expr(Basic):
    pass


class Integer(Expr):
    pass


class Series:
    pass


T = TypeVar("T", bound=Basic)


@overload
def convert(value: int) -> Integer: ...
@overload
def convert(value: float) -> Expr: ...
@overload
def convert(value: Expr | complex) -> Expr: ...
@overload
def convert(value: T) -> T: ...
@overload
def convert(value: Any) -> Basic: ...
def convert(value: Any) -> Basic:
    return Basic()


def make(value, flag):
    value = convert(value)
    if flag:
        return value
    return Series()


def series_calls(value: Any):
    reveal_type(convert(value), expected_text="Unknown")
    reveal_type(make(Expr(), False), expected_text="Expr | Series")
    reveal_type(make(value, True), expected_text="Unknown | Series")
    reveal_type(make(Integer(), False), expected_text="Expr | Series")
    reveal_type(make(1, False), expected_text="Integer | Series")
    reveal_type(make(value, False), expected_text="Unknown | Series")
    reveal_type(make(Expr(), True), expected_text="Expr | Series")


class Matcher(Expr):
    def match(self, pattern):
        pattern = convert(pattern)
        return pattern.matches(self)


class DerivedMatcher(Matcher):
    pass


def matching_calls(value: Any, known: Expr):
    reveal_type(Matcher().match(known), expected_text="dict[str, int] | None")
    reveal_type(Matcher().match(value), expected_text="Unknown")
    reveal_type(DerivedMatcher().match(known), expected_text="dict[str, int] | None")
    reveal_type(Matcher().match(value), expected_text="Unknown")
    reveal_type(Matcher().match(known), expected_text="dict[str, int] | None")
