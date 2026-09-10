# This sample tests preservation of correlated overloads inferred from a
# protocol-annotated self parameter, including on gradual generic receivers.

from __future__ import annotations

from typing import Any, Generic, Literal, Protocol, TypeVar, assert_type, overload

T = TypeVar("T")
R = TypeVar("R")
P = TypeVar("P", contravariant=True)


class ItemOps(Generic[T]):
    @overload
    def _proto(self: ItemOps[int], other: int) -> ItemOps[str]: ...
    @overload
    def _proto(self: ItemOps[str], other: str) -> ItemOps[int]: ...
    def _proto(self, other: Any) -> Any:
        raise NotImplementedError


class SupportsOp(Protocol[P, R]):
    def _proto(self, other: P) -> ItemOps[R]: ...


class Container(ItemOps[T]):
    def op(self: SupportsOp[P, R], other: P) -> Container[R]:
        raise NotImplementedError

    @overload
    def converted(self: SupportsOp[P, R], other: P, *, wrapped: Literal[True] = True) -> Container[R]: ...
    @overload
    def converted(self: SupportsOp[P, R], other: P, *, wrapped: Literal[False]) -> R: ...
    def converted(self, other: Any, *, wrapped: bool = True) -> Any:
        raise NotImplementedError

    @overload
    def __floordiv__(self: SupportsOp[P, R], other: P) -> Container[R]: ...
    @overload
    def __floordiv__(self, other: bytes) -> Container[bytes]: ...
    def __floordiv__(self, other: Any) -> Any:
        raise NotImplementedError

    @overload
    def mixed(self: SupportsOp[P, R], other: P) -> Container[R]: ...
    @overload
    def mixed(self: Container[int], other: str) -> Container[bytes]: ...
    def mixed(self, other: Any) -> Any:
        raise NotImplementedError


@overload
def choose(value: list[int]) -> Container[int]: ...
@overload
def choose(value: list[str]) -> Container[str]: ...
def choose(value: Any) -> Any:
    raise NotImplementedError


def infer_result(value: SupportsOp[P, R]) -> R:
    raise NotImplementedError


def check(
    concrete: Container[str],
    gradual: Container[Any],
    unknown: Container,
    value: list[Any],
) -> None:
    assert_type(concrete.op("value"), Container[int])
    assert_type(gradual._proto("value"), ItemOps[int])
    assert_type(gradual.op("value"), Container[int])
    assert_type(gradual.op(1), Container[str])
    assert_type(unknown.op("value"), Container[int])
    assert_type(unknown.op(1), Container[str])
    assert_type(choose(value), Container[Any])
    assert_type(choose(value).op("value"), Container[int])
    assert_type(choose(value).op(1), Container[str])
    assert_type(Container.op(gradual, "value"), Container[int])

    assert_type(gradual.converted("value"), Container[int])
    assert_type(gradual.converted(1), Container[str])
    assert_type(gradual.converted("value", wrapped=False), int)
    assert_type(gradual.converted(1, wrapped=False), str)
    bound = gradual.converted
    assert_type(bound("value", wrapped=False), int)
    assert_type(bound(1, wrapped=False), str)
    assert_type(choose(value) // "value", Container[int])
    assert_type(choose(value) // 1, Container[str])
    assert_type(choose(value) // b"value", Container[bytes])
    assert_type(concrete.mixed("value"), Container[int])
    assert_type(gradual.mixed("value"), Container[Any])
    assert_type(infer_result(gradual), str)

    # This should generate two errors because no overload accepts bytes.
    gradual.op(b"invalid")

    # This should generate an error because the concrete receiver requires str.
    concrete.op(1)

    # This should generate an error because the container type is preserved.
    choose(value).op("value").nonexistent_member()

    # This should generate an error because no operator overload accepts object.
    _ = gradual // object()

    compatible: SupportsOp[str, int] = gradual
    assert_type(compatible._proto("value"), ItemOps[int])

    # This should generate an error because matching str requires an int result.
    incompatible: SupportsOp[str, str] = gradual
