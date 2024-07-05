# This sample tests the type checker's ability to check
# custom operator overrides.

# pyright: reportIncompatibleMethodOverride=false

from typing import NoReturn, Self


class A:
    def __eq__(self, Foo):
        return "equal"


class B:
    def __ne__(self, Bar):
        return self

    def __lt__(self, Bar):
        return "string"

    def __gt__(self, Bar):
        return "string"

    def __ge__(self, Bar):
        return "string"

    def __le__(self, Bar):
        return "string"


def needs_a_string(val: str):
    pass


def needs_a_string_or_bool(val: bool | str):
    pass


def test():
    a = A()
    needs_a_string(a == a)

    # This should generate an error because there
    # is no __ne__ operator defined, so a bool
    # value will result.
    needs_a_string(a != a)

    if True:
        a = B()

    # At this point, a should be of type Union[Foo, Bar],
    # so the == operator should return either a str or
    # a bool.
    needs_a_string_or_bool(a == a)

    # This should generate an error.
    needs_a_string(a == a)

    # This should generate an error.
    needs_a_string_or_bool(a != a)

    b = B()
    needs_a_string(b < b)
    needs_a_string(b > b)
    needs_a_string(b <= b)
    needs_a_string(b >= b)


class C:
    def __getattr__(self, name: str, /):
        if name == "__add__":
            return lambda _: 0


a = C()
a.__add__

# This should generate an error because __getattr__ is not used
# when looking up operator overload methods.
b = a + 0


class D:
    def __init__(self):
        self.__add__ = lambda x: x


d = D()

# This should generate an error because __add__ is not a class variable.
_ = d + d


class E:
    __slots__ = ("__add__",)

    def __init__(self):
        self.__add__ = lambda x: x


e = E()

_ = e + e


class F:
    def __add__(self, other: object) -> NoReturn: ...


f = F() + ""
reveal_type(f, expected_text="NoReturn")


class G:
    def __add__(self, other: int) -> Self:
        return self

    def method1(self) -> Self:
        return self + 0
