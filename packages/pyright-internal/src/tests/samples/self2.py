# This sample tests the usage of the Self type.

from dataclasses import dataclass
from typing import Callable, Generic, ParamSpec, Protocol, TypeVar

from typing_extensions import Self  # pyright: ignore[reportMissingModuleSource]

_P = ParamSpec("_P")
_R = TypeVar("_R")


class A(Generic[_P, _R]):
    val: _R

    def __init__(self, callback: Callable[_P, _R]) -> None:
        self.callback = callback

    def method1(self: Self) -> Self:
        return self

    def method2(self) -> Self:
        return self

    @classmethod
    def method3(cls: type[Self]) -> type[Self]:
        return cls

    @classmethod
    def method4(cls) -> type[Self]:
        return cls


_T = TypeVar("_T")


class B(Generic[_T]):
    def __init__(self, value: _T):
        self.value = value


class Shape1:
    def set_scale(self, scale: float) -> Self:
        self.scale = scale
        return self

    @classmethod
    def from_config(cls, config: dict[str, float]) -> Self:
        return cls()


class Circle1(Shape1): ...


x1 = Shape1().set_scale(3.4)
reveal_type(x1, expected_text="Shape1")

x2 = Circle1().set_scale(3.4)
reveal_type(x2, expected_text="Circle1")


class Shape2:
    def set_scale(self: Self, scale: float) -> Self:
        self.scale = scale
        return self

    @classmethod
    def from_config(cls: type[Self], config: dict[str, float]) -> Self:
        return cls()

    def difference(self: Self, other: Self) -> float: ...

    def apply(self: Self, f: Callable[[Self], None]) -> None: ...


class Circle2(Shape2): ...


s2 = Shape2()
x3 = s2.set_scale(3.4)
reveal_type(x3, expected_text="Shape2")

c2 = Circle2()
x4 = c2.set_scale(3.4)
reveal_type(x4, expected_text="Circle2")

c2.difference(c2)
s2.difference(c2)
s2.difference(s2)

# This should generate an error.
c2.difference(s2)


@dataclass
class LinkedList(Generic[_T]):
    value: _T
    next: Self | None = None


LinkedList[int](value=1, next=LinkedList[int](value=2))


@dataclass
class OrdinalLinkedList(LinkedList[int]):
    def ordinal_value(self) -> str:
        return str(self.value)


# This should generate an error.
xs = OrdinalLinkedList(value=1, next=LinkedList[int](value=2))

if xs.next is not None:
    xs.next = OrdinalLinkedList(value=3, next=None)

    # This should generate an error.
    xs.next = LinkedList[int](value=3, next=None)


class Container(Generic[_T]):
    value: _T

    def set_value(self, value: _T) -> Self: ...


def object_with_concrete_type(
    int_container: Container[int], str_container: Container[str]
) -> None:
    reveal_type(int_container.set_value(0), expected_text="Container[int]")
    reveal_type(str_container.set_value(""), expected_text="Container[str]")


def object_with_generic_type(container: Container[_T], value: _T) -> Container[_T]:
    return container.set_value(value)


class ShapeProtocol(Protocol):
    def set_scale(self, scale: float) -> Self: ...


class ReturnSelf:
    scale: float = 1.0

    def set_scale(self, scale: float) -> Self:
        self.scale = scale
        return self


class ReturnConcreteShape:
    scale: float = 1.0

    def set_scale(self, scale: float) -> Self:
        self.scale = scale
        return self


class BadReturnType:
    scale: float = 1.0

    def set_scale(self, scale: float) -> int:
        self.scale = scale
        return 42


class ReturnDifferentClass:
    scale: float = 1.0

    def set_scale(self, scale: float) -> ReturnConcreteShape:
        return ReturnConcreteShape()


def accepts_shape(shape: ShapeProtocol) -> None:
    y = shape.set_scale(0.5)
    reveal_type(y)


def main(
    return_self_shape: ReturnSelf,
    return_concrete_shape: ReturnConcreteShape,
    bad_return_type: BadReturnType,
    return_different_class: ReturnDifferentClass,
) -> None:
    accepts_shape(return_self_shape)
    accepts_shape(return_concrete_shape)

    # This should generate an error.
    accepts_shape(bad_return_type)

    # This should generate an error.
    accepts_shape(return_different_class)


class StateManager:
    def __init__(self) -> None:
        self.state: list[Self] = self.get_state()

    def get_state(self) -> list[Self]: ...
