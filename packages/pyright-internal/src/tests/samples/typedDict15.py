# This sample tests the type compatibility checks when the source
# is a TypedDict and the dest is a protocol.

from typing import Protocol, TypeVar, TypedDict


class HasName(Protocol):
    name: str


class SupportsClear(Protocol):
    def clear(self) -> None: ...


_T = TypeVar("_T")


class SupportsUpdate(Protocol):
    def update(self: _T, __m: _T) -> None: ...


class B(TypedDict):
    name: str


def print_name(x: HasName):
    print(x.name)


my_typed_dict: B = {"name": "my name"}

# This should generate an error. The "name"
# attribute of a TypedDict can't be accessed
# through a member access expression.
print_name(my_typed_dict)


def do_clear(x: SupportsClear):
    x.clear()


# This should generate an error. Although a "dict"
# class supports clear, a TypedDict does not.
do_clear(my_typed_dict)


def do_update(x: SupportsUpdate):
    x.update(x)


do_update(my_typed_dict)
