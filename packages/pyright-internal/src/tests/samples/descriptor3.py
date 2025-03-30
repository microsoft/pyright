# This sample tests that bidirectional type inference works when
# assigning to a class-scoped variable that is annotated with a
# descriptor. The setter type should not be used in this case.


from typing import Callable, Generic, TypeVar


T = TypeVar("T")


class Desc1(Generic[T]):
    def __get__(
        self, instance: object | None, owner: type | None = None
    ) -> list[T]: ...

    def __set__(self, instance: object, value: list[T]) -> None: ...


def func1(factory: Callable[[], list[T]]) -> Desc1[T]: ...


class ClassA:
    not_working: Desc1[int] = func1(list)
