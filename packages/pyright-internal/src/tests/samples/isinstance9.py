# This sample tests the isinstance narrowing when the list
# of classes includes a type defined by a type variable.

from typing import Any, Literal, Type, TypeVar, Union

T = TypeVar("T")


def func1(cls: Type[T], obj: Any) -> T:
    assert isinstance(obj, cls)
    t_obj: Literal["T@func1"] = reveal_type(obj)
    return obj


v1 = func1(int, 3)
t_v1: Literal["int"] = reveal_type(v1)


def func2(klass: Type[T], obj: Union[T, int]) -> T:
    assert isinstance(obj, klass)
    t_obj: Literal["T@func2"] = reveal_type(obj)
    return obj


v2 = func2(str, 3)
t_v2: Literal["str"] = reveal_type(v2)
