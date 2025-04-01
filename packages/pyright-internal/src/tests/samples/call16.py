# This sample tests bidirectional type inference for calls where the expected
# type is a union.

from typing import Any, AnyStr, Iterable, Literal, TypeVar, overload

T = TypeVar("T")


class ItemBase: ...


class Item(ItemBase): ...


def gen_items() -> Iterable[Item]:
    return []


def make_list(val: Iterable[T]) -> list[T]:
    return list(val)


x: ItemBase | list[ItemBase | None] = make_list(gen_items())


@overload
def urlunsplit(components: Iterable[None]) -> Literal[b""]: ...


@overload
def urlunsplit(components: Iterable[AnyStr | None]) -> AnyStr: ...


def urlunsplit(components: Iterable[Any]) -> Any: ...


def func(url: str, candidates: list[Any]) -> str | None:
    return urlunsplit(candidates[0])
