# This sample tests that a descriptor returned by a __getattr__ method
# is not applied as part of a member access expression evaluation.

from typing import Any, Generic, TypeVar

_T = TypeVar("_T")


class A:
    pass


class Descriptor:
    def __get__(self, instance: object, owner: Any) -> A:
        return A()


class CollectionThing(Generic[_T]):
    thing: _T

    def __getitem__(self, key: str) -> _T:
        return self.thing

    def __getattr__(self, key: str) -> _T:
        return self.thing


c1: CollectionThing[Descriptor] = CollectionThing()

reveal_type(c1["key"], expected_text="Descriptor")
reveal_type(c1.key, expected_text="Descriptor")
