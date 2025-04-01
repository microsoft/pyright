# This sample tests a protocol that uses generics in the "self"
# parameter.

from typing import Protocol, Self, TypeVar

T = TypeVar("T")


class HasParent(Protocol):
    def get_parent(self: T) -> T: ...


GenericNode = TypeVar("GenericNode", bound=HasParent)


def generic_get_parent(n: GenericNode) -> GenericNode:
    return n.get_parent()


class ConcreteNode:
    def get_parent(self) -> Self:
        return self


node = ConcreteNode()
parent = generic_get_parent(node)
