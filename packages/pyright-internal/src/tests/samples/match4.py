# This sample tests type checking for match statements (as
# described in PEP 634) that contain value patterns.

from enum import Enum
from typing import Literal, Tuple, TypeVar, Union
from http import HTTPStatus

def handle_reply(reply: Tuple[HTTPStatus, str] | Tuple[HTTPStatus]):
    match reply:
        case (HTTPStatus.OK as a1, a2):
            t_a1: Literal["Literal[HTTPStatus.OK]"] = reveal_type(a1)
            t_a2: Literal["str"] = reveal_type(a2)

        case (HTTPStatus.NOT_FOUND as d1, ):
            t_d1: Literal["Literal[HTTPStatus.NOT_FOUND]"] = reveal_type(d1)


class MyEnum(Enum):
    V1 = 0
    V2 = 1

class MyClass:
    class_var_1: "MyClass"

    def __eq__(self, object: "MyClass") -> bool: ...

def test_unknown(value_to_match):
    match value_to_match:
        case MyEnum.V1 as a1:
            t_a1: Literal["Unknown"] = reveal_type(a1)


def test_enum(value_to_match: MyEnum):
    match value_to_match:
        case MyEnum.V1 as a1:
            t_a1: Literal["Literal[MyEnum.V1]"] = reveal_type(a1)

def test_class_var(value_to_match: str):
    match value_to_match:
        case MyClass.class_var_1 as a1:
            t_a1: Literal["Never"] = reveal_type(a1)


TInt = TypeVar("TInt", bound=MyEnum)

def test_bound_typevar(value_to_match: TInt) -> TInt:
    match value_to_match:
        case MyEnum.V1 as a1:
            t_a1: Literal["Literal[MyEnum.V1]"] = reveal_type(a1)

    return value_to_match

def test_union(value_to_match: Union[TInt, MyEnum]) -> Union[TInt, MyEnum]:
    match value_to_match:
        case MyEnum.V1 as a1:
            t_a1: Literal["Literal[MyEnum.V1]"] = reveal_type(a1)

    return value_to_match



