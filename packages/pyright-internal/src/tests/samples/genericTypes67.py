# This sample tests for proper handling of constrained or bound TypeVars.

from typing import Dict, Generic, Literal, Optional, TypeVar, Union


class IntSubclass1(int):
    pass


_T1 = TypeVar("_T1", int, IntSubclass1)


def add1(value: _T1) -> _T1:
    t1: Literal["int*"] = reveal_type(value + 1)

    # This should generate an error
    return value + 5


class IntSubclass2(int):
    def __add__(self, value: object) -> "IntSubclass2":
        ...


_T2 = TypeVar("_T2", int, IntSubclass2)


def add2(value: _T2) -> _T2:
    t1: Literal["int* | IntSubclass2*"] = reveal_type(value + 1)
    return value + 5


class A:
    ...


class B:
    ...


_T3 = TypeVar("_T3", bound=Union[A, B])


class Registry(Generic[_T3]):
    def __init__(self) -> None:
        self.registry = {}

    @property
    def registry(self) -> Dict[str, _T3]:
        ...

    @registry.setter
    def registry(self, registry: Dict[str, _T3]) -> None:
        ...

    def get(self, _id: str) -> Optional[_T3]:
        return self.registry.get(_id)
