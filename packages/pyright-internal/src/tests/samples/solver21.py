# This sample tests for proper handling of bound TypeVars.

from typing import Generic, TypeVar


class A: ...


class B: ...


_T3 = TypeVar("_T3", bound=A | B)


class Registry(Generic[_T3]):
    def __init__(self) -> None:
        self.registry = {}

    @property
    def registry(self) -> dict[str, _T3]: ...

    @registry.setter
    def registry(self, registry: dict[str, _T3]) -> None: ...

    def get(self, _id: str) -> _T3 | None:
        return self.registry.get(_id)
