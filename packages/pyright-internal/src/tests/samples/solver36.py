# This sample tests that upper bound constraints are honored when solving
# a type variable.

from typing import Generic, SupportsAbs, TypeVar


T = TypeVar("T")
P = TypeVar("P", bound=SupportsAbs)


class BaseContainer(Generic[T]):
    item: T


class Container(BaseContainer[P]):
    def __init__(self, obj: P) -> None:
        self.item = obj


def func1(obj: BaseContainer[T]) -> T:
    return obj.item


func1(Container(1))

func1(Container(1.0))


# This should generate an error because str isn't compatible with
# the bound of the TypeVar in Container.
func1(Container(""))
