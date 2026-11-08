from __future__ import annotations

from typing import Any, Callable, Concatenate, Generic, ParamSpec, Self, TypeVar, overload

P = ParamSpec("P")
Q = ParamSpec("Q")
R = TypeVar("R")
T = TypeVar("T")


class Base(Generic[P, R]):
    def __init__(self, fn: Callable[P, R]) -> None:
        self.fn = fn

    @overload
    def __get__(self, obj: None, objtype: type | None = None) -> Self: ...

    @overload
    def __get__(
        self: Base[Concatenate[Any, P], R],
        obj: object,
        objtype: type | None = None,
    ) -> Callable[P, R]: ...

    @overload
    def __get__(self, obj: object, objtype: type | None = None) -> Callable[..., R]: ...

    def __get__(self, obj: object | None, objtype: type | None = None) -> Any:
        raise NotImplementedError


class WrapperFresh(Generic[P, R]):
    def __init__(self, fn: Callable[P, R]) -> None:
        self.fn = fn

    @overload
    def __get__(self, obj: None, objtype: type | None = None) -> Self: ...

    @overload
    def __get__(
        self: WrapperFresh[Concatenate[Any, Q], T],
        obj: object,
        objtype: type | None = None,
    ) -> Callable[Q, T]: ...

    @overload
    def __get__(self, obj: object, objtype: type | None = None) -> Callable[..., R]: ...

    def __get__(self, obj: object | None, objtype: type | None = None) -> Any:
        raise NotImplementedError


class WrapperStrReceiver(Generic[P, R]):
    def __init__(self, fn: Callable[P, R]) -> None:
        self.fn = fn

    @overload
    def __get__(self, obj: None, objtype: type | None = None) -> Self: ...

    @overload
    def __get__(
        self: WrapperStrReceiver[Concatenate[str, P], R],
        obj: object,
        objtype: type | None = None,
    ) -> Callable[P, R]: ...

    @overload
    def __get__(self, obj: object, objtype: type | None = None) -> Callable[..., R]: ...

    def __get__(self, obj: object | None, objtype: type | None = None) -> Any:
        raise NotImplementedError


class Child(Base[P, R], Generic[P, R]):
    def child_only(self) -> int:
        return 1


class NestedWrapper(Generic[P, R]):
    @overload
    def __get__(self, obj: None, objtype: type | None = None) -> Self: ...

    @overload
    def __get__(
        self: NestedWrapper[Any, list[Callable[Concatenate[Any, P], R]]],
        obj: object,
        objtype: type | None = None,
    ) -> Callable[P, R]: ...

    @overload
    def __get__(self, obj: object, objtype: type | None = None) -> Callable[..., Any]: ...

    def __get__(self, obj: object | None, objtype: type | None = None) -> Any:
        raise NotImplementedError


class SingleSignatureWrapper(Generic[P, R]):
    def __get__(
        self: SingleSignatureWrapper[Concatenate[Any, P], R],
        obj: object,
        objtype: type | None = None,
    ) -> Callable[P, R]:
        raise NotImplementedError


def wrap_reuse(fn: Callable[P, R]) -> Base[P, R]:
    return Base(fn)


def wrap_child(fn: Callable[P, R]) -> Child[P, R]:
    return Child(fn)


def wrap_fresh(fn: Callable[P, R]) -> WrapperFresh[P, R]:
    return WrapperFresh(fn)


def wrap_str_receiver(fn: Callable[P, R]) -> WrapperStrReceiver[P, R]:
    return WrapperStrReceiver(fn)


def wrap_nested(fn: Callable[P, R]) -> NestedWrapper[P, list[Callable[P, R]]]:
    return NestedWrapper()


def wrap_single(fn: Callable[P, R]) -> SingleSignatureWrapper[P, R]:
    return SingleSignatureWrapper()


class A:
    @wrap_reuse
    def reuse(self, x: int) -> bool:
        return True

    @wrap_fresh
    def fresh(self, x: int) -> bool:
        return True

    @wrap_str_receiver
    def incompatible_receiver(self, x: int) -> bool:
        return True

    @wrap_child
    def inherited(self, x: int) -> bool:
        return True

    @wrap_nested
    def nested(self, x: int) -> bool:
        return True

    @wrap_single
    def single(self, x: int) -> bool:
        return True


reveal_type(A().reuse, expected_text="(x: int) -> bool")
reveal_type(A().fresh, expected_text="(x: int) -> bool")
reveal_type(A().incompatible_receiver, expected_text="(...) -> bool")
reveal_type(A().inherited, expected_text="(x: int) -> bool")
reveal_type(A().nested, expected_text="(x: int) -> bool")
reveal_type(A().single, expected_text="(x: int) -> bool")
reveal_type(A.inherited, expected_text="Child[(self: A, x: int), bool]")
reveal_type(A.inherited.child_only, expected_text="() -> int")


def strip_first(fn: Callable[Concatenate[Any, P], R]) -> Callable[P, R]:
    raise NotImplementedError


def ordinary_callable(receiver: object, value: int) -> bool:
    return True


reveal_type(strip_first(ordinary_callable), expected_text="(value: int) -> bool")


class NonDescriptor(Generic[P, R]):
    @overload
    def bind(self: NonDescriptor[Concatenate[Any, P], R], obj: object) -> Callable[P, R]: ...

    @overload
    def bind(self, obj: object) -> Callable[..., R]: ...

    def bind(self, obj: object) -> Callable[..., R]:
        raise NotImplementedError


non_descriptor = NonDescriptor[[object, int], bool]()
reveal_type(non_descriptor.bind(object()), expected_text="(...) -> bool")
