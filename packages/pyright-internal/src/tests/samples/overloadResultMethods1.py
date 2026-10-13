from typing import Any, Generic, Never, TypeVar, assert_type, overload, reveal_type

T = TypeVar("T")


class Container(Generic[T]):
    @overload
    def copy(self: "Container[int]") -> "Container[int]": ...
    @overload
    def copy(self: "Container[str]") -> "Container[str]": ...
    def copy(self) -> "Container[Any]":
        return self

    def item(self) -> T:
        raise NotImplementedError

    def size(self) -> int:
        return 0

    def accept(self, value: T) -> None:
        pass

    def extend(self, values: list[T]) -> None:
        pass

    @overload
    def combine(self: "Container[int]", other: "Container[int]") -> "Container[int]": ...
    @overload
    def combine(self: "Container[str]", other: "Container[str]") -> "Container[str]": ...
    def combine(self, other: "Container[Any]") -> "Container[Any]":
        return self


def assigned(value: Container[Any]) -> None:
    ret = value.copy()
    alias = ret
    integer: Container[int] = alias
    string: Container[str] = alias
    reveal_type(alias)
    ret.accept(1)
    ret.accept("x")
    ret.item().bit_length()
    ret.item().upper()
    # Each negative control must remain an error.
    ret.accept(3.14)
    ret.extend([1, "x"])
    invalid: Container[bytes] = ret
    ret.nonexistent_member()
    unrelated: int = "bad"


def inline(value: Container[Any], concrete: Container[int]) -> None:
    reveal_type(value.copy())
    reveal_type(value.copy().item())
    reveal_type(concrete.copy())
    assert_type(value.copy().size(), int)
    value.copy().accept(1)
    value.copy().accept("x")
    value.copy().item().bit_length()
    value.copy().item().upper()
    value.copy().accept(3.14)
    value.copy().extend([1, "x"])
    value.copy().nonexistent_member()
    value.copy().item().nonexistent_member()
    terminal = value.copy().item().upper()
    terminal.upper()
    terminal.nonexistent_member()


def projected(value: Container[Any]) -> None:
    ret = value.copy()
    item = ret.item()
    reveal_type(item)
    item.upper()
    item.bit_length()
    item.nonexistent_member()


def arguments(value: Container[Any], other: Container[Any]) -> None:
    ret = value.combine(other)
    integer: Container[int] = ret
    string: Container[str] = ret
    ret.accept(1)
    ret.accept("x")
    ret.accept(2.5)


class Reversed(Generic[T]):
    @overload
    def copy(self: "Reversed[str]") -> "Reversed[str]": ...
    @overload
    def copy(self: "Reversed[int]") -> "Reversed[int]": ...
    def copy(self) -> "Reversed[Any]":
        return self

    def item(self) -> T:
        raise NotImplementedError


def reversed_order(value: Reversed[Any], concrete: Reversed[str]) -> None:
    ret = value.copy()
    integer: Reversed[int] = ret
    string: Reversed[str] = ret
    reveal_type(ret)
    reveal_type(concrete.copy())
    ret.item().bit_length()
    ret.item().upper()
    ret.nonexistent_member()


class Original(Generic[T]):
    @overload
    def copy(self: "Original[Never]") -> "Original[Any]": ...
    @overload
    def copy(self: "Original[int]") -> "Original[int]": ...
    @overload
    def copy(self: "Original[float]") -> "Original[float]": ...
    def copy(self) -> "Original[Any]":
        return self


def original(value: Original[Any], concrete: Original[int]) -> None:
    reveal_type(value.copy())
    reveal_type(concrete.copy())
    value.copy().nonexistent_member()


def escaped(value: Container[Any]) -> Container[Any]:
    ret = value.copy()
    return ret


def unknown(value: Container) -> None:
    ret = value.copy()
    reveal_type(ret)
    ret.nonexistent_member()
