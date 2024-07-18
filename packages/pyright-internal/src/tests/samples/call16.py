# This sample tests bidirectional type inference for calls where the expected
# type is a union.

from typing import Iterable, TypeVar

T = TypeVar("T")


class ItemBase:
    ...


class Item(ItemBase):
    ...


def gen_items() -> Iterable[Item]:
    return []


def make_list(val: Iterable[T]) -> list[T]:
    return list(val)


x: ItemBase | list[ItemBase | None] = make_list(gen_items())
