# This sample tests the handling of TypeVar defaults in classes
# with a constructor that defines an __init__ but no __new__.

from dataclasses import dataclass
from typing import Any, overload


class ClassA: ...


@dataclass
class ClassB[T: ClassA = ClassA]:
    owner: T


def post_comment[T: ClassA](owner: T) -> ClassB[T]:
    return ClassB(owner)


class ClassC: ...


@overload
def func1(x: ClassA) -> ClassA: ...
@overload
def func1[T1 = str](x: ClassC | T1) -> T1: ...
def func1(x: Any) -> Any: ...


reveal_type(func1(ClassC()), expected_text="str")
