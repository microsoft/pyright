from typing import Self, assert_type


class First:
    def __lt__(self, other: object) -> Self:
        return self

    def __le__(self, other: object) -> Self:
        return self

    def __gt__(self, other: object) -> Self:
        return self

    def __ge__(self, other: object) -> Self:
        return self


class Second:
    def __lt__(self, other: object) -> Self:
        return self

    def __le__(self, other: object) -> Self:
        return self

    def __gt__(self, other: object) -> Self:
        return self

    def __ge__(self, other: object) -> Self:
        return self


class FirstChild(First):
    pass


class SecondChild(Second):
    pass


def less[T: First | Second](left: T, right: T):
    return (left,) < (right,)


def less_equal[T: First | Second](left: T, right: T):
    return (left,) <= (right,)


def greater[T: First | Second](left: T, right: T):
    return (left,) > (right,)


def greater_equal[T: First | Second](left: T, right: T):
    return (left,) >= (right,)


def reverse_less[T: Second | First](left: T, right: T):
    return (left,) < (right,)


def reverse_less_equal[T: Second | First](left: T, right: T):
    return (left,) <= (right,)


def reverse_greater[T: Second | First](left: T, right: T):
    return (left,) > (right,)


def reverse_greater_equal[T: Second | First](left: T, right: T):
    return (left,) >= (right,)


def scalar[T: First | Second](left: T, right: T) -> T:
    return left < right


def needs_first(value: FirstChild | bool) -> None:
    pass


def needs_second(value: SecondChild | bool) -> None:
    pass


def needs_bool(value: bool) -> None:
    pass


assert_type(less(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(less_equal(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(greater(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(greater_equal(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(reverse_less(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(reverse_less_equal(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(reverse_greater(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(reverse_greater_equal(FirstChild(), FirstChild()), FirstChild | bool)
assert_type(less(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(less_equal(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(greater(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(greater_equal(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(reverse_less(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(reverse_less_equal(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(reverse_greater(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(reverse_greater_equal(SecondChild(), SecondChild()), SecondChild | bool)
assert_type(scalar(FirstChild(), FirstChild()), FirstChild)
needs_first(less(FirstChild(), FirstChild()))
needs_first(less_equal(FirstChild(), FirstChild()))
needs_first(greater(FirstChild(), FirstChild()))
needs_first(greater_equal(FirstChild(), FirstChild()))
needs_second(reverse_less(SecondChild(), SecondChild()))
needs_second(reverse_less_equal(SecondChild(), SecondChild()))
needs_second(reverse_greater(SecondChild(), SecondChild()))
needs_second(reverse_greater_equal(SecondChild(), SecondChild()))

# All successful custom returns must remain visible to bool-only consumers.
needs_bool(less(FirstChild(), FirstChild()))
needs_bool(less_equal(FirstChild(), FirstChild()))
needs_bool(greater(FirstChild(), FirstChild()))
needs_bool(greater_equal(FirstChild(), FirstChild()))
needs_bool(reverse_less(SecondChild(), SecondChild()))
needs_bool(reverse_greater_equal(SecondChild(), SecondChild()))
