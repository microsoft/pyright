# This sample tests the case where a higher-order function receives
# a generic function as an argument, and the type of the generic
# function depends on one of the other arguments passed to the
# higher-order function. This shouldn't depend on the order the
# arguments are passed.


from typing import Protocol, TypeVar


T = TypeVar("T")


class Proto1(Protocol[T]):
    def method(self, v: T) -> T: ...


class Impl1:
    def method(self, v: T) -> T: ...


def func1(a: Proto1[T], b: T) -> T: ...


v1 = func1(a=Impl1(), b="abc")
reveal_type(v1, expected_text="str")

v2 = func1(b="abc", a=Impl1())
reveal_type(v2, expected_text="str")

v3 = func1(a=Impl1(), b=1)
reveal_type(v3, expected_text="int")

v4 = func1(b=1, a=Impl1())
reveal_type(v4, expected_text="int")
