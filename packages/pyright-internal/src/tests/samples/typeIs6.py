# This sample tests type narrowing for type(x) checks.

from typing import final

@final
class FinalA: pass

@final
class FinalB: pass

def func1(x: int | str, cls: type[int]):
    if type(x) is cls:
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")

def func2(x: int | str, y: int):
    if type(x) is type(y):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")

def func3(x: int | str, cls: type[int]):
    if cls is type(x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")

def func4(x: int | str):
    if int is type(x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")

def func5(x: int | str, cls: type[int]):
    if type(x) == cls:
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")

def func6(x: FinalA | FinalB, cls: type[FinalA]):
    if type(x) is cls:
        reveal_type(x, expected_text="FinalA")
    else:
        reveal_type(x, expected_text="FinalB")

def func7(x: int | str, cls: type[int] | type[str]):
    if type(x) is cls:
        reveal_type(x, expected_text="int | str")

class Base: pass

@final
class FinalSub(Base): pass

def func8(x: Base):
    if type(x) is not FinalSub:
        reveal_type(x, expected_text="Base")
    else:
        reveal_type(x, expected_text="FinalSub")

class Index: pass

class MultiIndex(Index): pass

def test_spark_regression(self_val: MultiIndex, other: Index):
    if type(self_val) is not type(other):
        pass
    reveal_type(self_val, expected_text="MultiIndex")

def test_direct_class_vs_type_param(x: Base, cls: type[Base]):
    if type(x) is not Base:
        reveal_type(x, expected_text="Base")
    
    if type(x) is not cls:
        reveal_type(x, expected_text="Base")


def func9(value: bool, kind: type[int]):
    if type(value) is kind:
        reveal_type(value, expected_text="bool")


def func10[T](value: object, kind: type[T]) -> T:
    if type(value) is kind:
        reveal_type(value, expected_text="object*")
        return value
    raise TypeError


class A: pass

class B: pass

class C(A, B): pass


def func11(x: A, cls: type[B]):
    # A subclass of both A and B (such as C) could satisfy the comparison.
    if type(x) is cls:
        reveal_type(x, expected_text="A")


def func12(x: int | str, y: int):
    if type(y) is type(x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")


def get_class() -> type[int]: ...


def func13(x: int | str):
    if get_class() is type(x):
        reveal_type(x, expected_text="int")
    else:
        reveal_type(x, expected_text="int | str")


def func14(x: int | str, cls: type[int]):
    if cls is not type(x):
        reveal_type(x, expected_text="int | str")
    else:
        reveal_type(x, expected_text="int")

    if cls == type(x):
        reveal_type(x, expected_text="int")

    if cls != type(x):
        reveal_type(x, expected_text="int | str")
    else:
        reveal_type(x, expected_text="int")

    if type(x) != cls:
        reveal_type(x, expected_text="int | str")
    else:
        reveal_type(x, expected_text="int")


def func15(x: int | str):
    if type(x) is not bool:
        reveal_type(x, expected_text="int | str")
    else:
        reveal_type(x, expected_text="bool")


def func16(x: int | str, cls: type[int] | type[object]):
    if type(x) is cls:
        reveal_type(x, expected_text="int | str")


def func17(x: int | str):
    if type(x) is object:
        reveal_type(x, expected_text="Never")
