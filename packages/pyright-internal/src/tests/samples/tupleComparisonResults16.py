# Preserve original generic operands when binding comparison methods.
from typing import Self, assert_type


class Order:
    def __lt__(self, other: object) -> Self:
        return self

    def __le__(self, other: object) -> Self:
        return self

    def __gt__(self, other: object) -> Self:
        return self

    def __ge__(self, other: object) -> Self:
        return self


class Child(Order):
    pass


class GrandChild(Child):
    pass


def less[T: Order](left: T, right: T):
    return (left,) < (right,)


def less_equal[T: Order](left: T, right: T):
    return (left,) <= (right,)


def greater[T: Order](left: T, right: T):
    return (left,) > (right,)


def greater_equal[T: Order](left: T, right: T):
    return (left,) >= (right,)


def scalar[T: Order](left: T, right: T):
    return left < right


def direct[T: Order](left: T, right: T):
    return left.__lt__(right)


def declared[T: Order](left: T, right: T) -> T | bool:
    return (left,) < (right,)


child_lt: Child | bool = less(Child(), Child())
child_le: Child | bool = less_equal(Child(), Child())
child_gt: Child | bool = greater(Child(), Child())
child_ge: Child | bool = greater_equal(Child(), Child())
assert_type(less(Child(), Child()), Child | bool)
assert_type(less_equal(Child(), Child()), Child | bool)
assert_type(greater(Child(), Child()), Child | bool)
assert_type(greater_equal(Child(), Child()), Child | bool)
assert_type(scalar(Child(), Child()), Child)
assert_type(direct(Child(), Child()), Child)
assert_type(declared(Child(), Child()), Child | bool)


def reflected[T: Child](left: Order, right: T, _other: T):
    return (left,) < (right,), (left,) <= (right,), (left,) > (right,), (left,) >= (right,)


reflected_result: tuple[GrandChild | bool, GrandChild | bool, GrandChild | bool, GrandChild | bool] = reflected(
    Order(), GrandChild(), GrandChild()
)
assert_type(
    reflected(Order(), GrandChild(), GrandChild()),
    tuple[GrandChild | bool, GrandChild | bool, GrandChild | bool, GrandChild | bool],
)


class Echo:
    def __lt__[R](self, other: R) -> R:
        return other

    def __le__[R](self, other: R) -> R:
        return other

    def __gt__[R](self, other: R) -> R:
        return other

    def __ge__[R](self, other: R) -> R:
        return other


def echo[T](left: Echo, right: tuple[T, T]):
    return (
        (left,) < (right[0],),
        (left,) <= (right[0],),
        (left,) > (right[0],),
        (left,) >= (right[0],),
    )


echo_result: tuple[str | bool, str | bool, str | bool, str | bool] = echo(Echo(), ("a", "b"))
assert_type(echo(Echo(), ("a", "b")), tuple[str | bool, str | bool, str | bool, str | bool])


def needs_bool(value: bool) -> None:
    pass


needs_bool(less(Child(), Child()))  # This should generate an argument-type error.
needs_bool(less_equal(Child(), Child()))  # This should generate an argument-type error.
needs_bool(greater(Child(), Child()))  # This should generate an argument-type error.
needs_bool(greater_equal(Child(), Child()))  # This should generate an argument-type error.
needs_bool(reflected(Order(), GrandChild(), GrandChild())[0])  # This should generate an argument-type error.
needs_bool(echo(Echo(), ("a", "b"))[0])  # This should generate an argument-type error.
