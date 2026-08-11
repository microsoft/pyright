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
