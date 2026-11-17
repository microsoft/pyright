# Inferred rich-comparison results must retain their generic relationships.
from types import NotImplementedType
from typing import assert_type


class Order[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __lt__(self, other: object) -> T:
        return self.value

    def __le__(self, other: object) -> T:
        return self.value

    def __gt__(self, other: object) -> T:
        return self.value

    def __ge__(self, other: object) -> T:
        return self.value


def less[T](left: Order[T], right: Order[T]):
    return (left,) < (right,)


def less_equal[T](left: Order[T], right: Order[T]):
    return (left,) <= (right,)


def greater[T](left: Order[T], right: Order[T]):
    return (left,) > (right,)


def greater_equal[T](left: Order[T], right: Order[T]):
    return (left,) >= (right,)


def explicit_return[T](left: Order[T], right: Order[T]) -> T | bool:
    return (left,) < (right,)


def scalar[T](left: Order[T], right: Order[T]):
    return left < right


text: str | bool = less(Order("a"), Order("b"))
assert_type(less(Order("a"), Order("b")), str | bool)
assert_type(less_equal(Order("a"), Order("b")), str | bool)
assert_type(greater(Order("a"), Order("b")), str | bool)
assert_type(greater_equal(Order("a"), Order("b")), str | bool)
assert_type(less(Order(1), Order(2)), int | bool)
assert_type(less_equal(Order(1), Order(2)), int | bool)
assert_type(greater(Order(1), Order(2)), int | bool)
assert_type(greater_equal(Order(1), Order(2)), int | bool)
assert_type(explicit_return(Order("a"), Order("b")), str | bool)
assert_type(scalar(Order("a"), Order("b")), str)


class Text(str):
    pass


def bounded[T: str](left: Order[T], right: Order[T]):
    return (left,) < (right,)


def constrained[T: (str, int)](left: Order[T], right: Order[T]):
    return (left,) < (right,)


subclass_result: Text | bool = bounded(Order(Text("a")), Order(Text("b")))
assert_type(bounded(Order(Text("a")), Order(Text("b"))), Text | bool)
assert_type(constrained(Order("a"), Order("b")), str | bool)
assert_type(constrained(Order(1), Order(2)), int | bool)


class Declining[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __lt__(self, other: object) -> T | NotImplementedType:
        return self.value

    def __gt__(self, other: object) -> bytes:
        return b"reflected"


def declining[T](left: Declining[T], right: Declining[T]):
    return (left,) < (right,)


assert_type(declining(Declining("a"), Declining("b")), str | bytes | bool)


class MaybeOrder[T: str | NotImplementedType]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __lt__(self, other: object) -> T:
        return self.value

    def __gt__(self, other: object) -> bytes:
        return b"reflected"


def maybe[T: str | NotImplementedType](left: MaybeOrder[T], right: MaybeOrder[T]):
    return (left,) < (right,)


assert_type(maybe(MaybeOrder("a"), MaybeOrder("b")), str | bytes | bool)


def needs_bool(value: bool) -> None:
    pass


needs_bool(less(Order("a"), Order("b")))  # This should generate an argument-type error.
needs_bool(bounded(Order(Text("a")), Order(Text("b"))))  # This should generate an argument-type error.
