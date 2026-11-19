# Opaque TypeVar expansion must not multiply optional inferred alternatives.
from typing import Literal, TypeVar, assert_type


type Choices = (
    tuple[tuple[Literal[0]]]
    | tuple[tuple[Literal[1]]]
    | tuple[tuple[Literal[2]]]
    | tuple[tuple[Literal[3]]]
    | tuple[tuple[Literal[4]]]
    | tuple[tuple[Literal[5]]]
    | tuple[tuple[Literal[6]]]
    | tuple[tuple[Literal[7]]]
    | tuple[tuple[Literal[8]]]
    | tuple[tuple[Literal[9]]]
    | tuple[tuple[Literal[10]]]
    | tuple[tuple[Literal[11]]]
    | tuple[tuple[Literal[12]]]
    | tuple[tuple[Literal[13]]]
    | tuple[tuple[Literal[14]]]
    | tuple[tuple[Literal[15]]]
)

T = TypeVar("T", bound=Choices)


def direct(index: int, other: Choices) -> tuple[bool, Choices]:
    left = (
        ((0,),) if index == 0 else
        ((1,),) if index == 1 else
        ((2,),) if index == 2 else
        ((3,),) if index == 3 else
        ((4,),) if index == 4 else
        ((5,),) if index == 5 else
        ((6,),)
    )
    result = left < other
    assert_type(result, bool)
    assert_type(left[0][0], Literal[0, 1, 2, 3, 4, 5, 6])
    return result, other


def bounded(index: int, other: T) -> tuple[bool, T]:
    left = (
        ((0,),) if index == 0 else
        ((1,),) if index == 1 else
        ((2,),) if index == 2 else
        ((3,),) if index == 3 else
        ((4,),) if index == 4 else
        ((5,),) if index == 5 else
        ((6,),)
    )
    result = left < other
    assert_type(result, bool)
    assert_type(left[0][0], Literal[0, 1, 2, 3, 4, 5, 6])
    return result, other
