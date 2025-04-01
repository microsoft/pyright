# This sample tests a complex intersection between generic protocols
# and properties that are defined in mix-in classes.

from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar

T_co = TypeVar("T_co", covariant=True)
T = TypeVar("T")


class Proto(Protocol[T_co]):
    @property
    def prop(self) -> T_co: ...


@dataclass
class Model(Generic[T]):
    prop: T


class RootProto(Protocol[T_co]):
    @property
    def root(self) -> Proto[T_co]: ...


class RootMixin(Generic[T]):
    @property
    def prop(self: RootProto[T]) -> T:
        return self.root.prop


@dataclass
class Root(RootMixin[T]):
    root: Model[T]


def func1(s: Root[str]):
    x: Proto[str] = s
