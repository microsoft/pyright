# This sample tests type checking for match statements (as
# described in PEP 634) that contain class patterns.

from typing import Literal, TypeVar, Union

foo = 3

class ClassA:
    attr_a: int
    attr_b: str

def test_unknown(value_to_match):
    match value_to_match:
        case ClassA(attr_a=a2) as a1:
            t_a1: Literal["Unknown"] = reveal_type(a1)
            t_a2: Literal["Unknown"] = reveal_type(a2)

        # This should generate an error because foo isn't instantiable.
        case foo() as a3:
            pass

def test_custom_type(value_to_match: ClassA):
    match value_to_match:
        case int() as a1:
            t_a1: Literal["Never"] = reveal_type(a1)

        case ClassA() as a2:
            t_a2: Literal["ClassA"] = reveal_type(a2)

        case ClassA(attr_a=a4) as a3:
            t_a3: Literal["ClassA"] = reveal_type(a3)

            # This should be "int", but we don't yet support
            # type analysis for keyword arguments in class patterns.
            t_a4: Literal["Unknown"] = reveal_type(a4)

def test_literal(value_to_match: Literal[3]):
    match value_to_match:
        case int() as a1:
            t_a1: Literal["Literal[3]"] = reveal_type(a1)

        case float() as a2:
            t_a2: Literal["Literal[3]"] = reveal_type(a2)

        case str() as a3:
            t_a3: Literal["Never"] = reveal_type(a3)

TInt = TypeVar("TInt", bound=int)

def test_bound_typevar(value_to_match: TInt) -> TInt:
    match value_to_match:
        case int() as a1:
            t_a1: Literal["TInt@test_bound_typevar"] = reveal_type(a1)

        case float() as a2:
            t_a2: Literal["TInt@test_bound_typevar"] = reveal_type(a2)

        case str() as a3:
            t_a3: Literal["Never"] = reveal_type(a3)

    return value_to_match

def test_union(value_to_match: Union[TInt, Literal[3], float, str]) -> Union[TInt, Literal[3], float, str]:
    match value_to_match:
        case int() as a1:
            t_a1: Literal["TInt@test_union | Literal[3]"] = reveal_type(a1)

        case float() as a2:
            t_a2: Literal["TInt@test_union | float | Literal[3]"] = reveal_type(a2)

        case str() as a3:
            t_a3: Literal["str"] = reveal_type(a3)

    return value_to_match
