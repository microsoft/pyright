# This sample tests assignment and deletion through a data descriptor
# that lacks the corresponding __set__ or __delete__ method, and
# assignment and deletion of a descriptor on the class object, which
# replace or remove the class's entry without invoking the descriptor,
# and assignment through a union of data descriptors.

from typing import Any, ClassVar


class GetSet:
    def __get__(self, obj: object, owner: Any) -> int: ...
    def __set__(self, obj: object, value: int) -> None: ...


class GetDelete:
    def __get__(self, obj: object, owner: Any) -> int: ...
    def __delete__(self, obj: object) -> None: ...


class ClassA:
    getset = GetSet()
    getdelete = GetDelete()


def func1(a: ClassA):
    a.getset = 1


def func2(a: ClassA):
    del a.getdelete


def func3(a: ClassA):
    # This should generate an error.
    del a.getset


def func4(a: ClassA):
    # This should generate an error.
    a.getdelete = 1


def func5():
    ClassA.getset = GetSet()
    ClassA.getdelete = GetDelete()


def func6():
    del ClassA.getset
    del ClassA.getdelete


def func7():
    # This should generate an error.
    ClassA.getset = 1


class ClassB:
    getdelete: GetDelete = GetDelete()


class ClassC:
    getdelete: GetSet | GetDelete = GetDelete()


def func8(b: ClassB):
    # This should generate an error.
    b.getdelete = 1


def func9(c: ClassC):
    # This should generate an error.
    c.getdelete = 1


class SetList[T]:
    def __set__(self, obj: object, value: list[T]) -> None: ...


class ClassD:
    attr: ClassVar[SetList[int] | SetList[str]]


def func10(d: ClassD):
    d.attr = []


def func11(d: ClassD):
    # This should generate an error.
    d.attr = [1]
