# This sample tests the handling of the `__call__` attribute.


from typing import Iterable, Iterator


class A:
    def __init__(self):
        self.__call__ = self.method1

    def method1(self, a: int):
        return a


# This should generate an error because `__call__` is
# callable only if it's a class variable.
A()(0)


class B:
    def method1(self, a: int):
        return a

    __call__ = method1


B()(0)


class C[K](Iterable[K]):
    def keys(self) -> Iterator[K]: ...

    __iter__ = keys
