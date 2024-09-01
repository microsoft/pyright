# This sample tests type inference rules for TypeForm.

# pyright: reportMissingModuleSource=false

from typing import (
    Annotated,
    Any,
    Callable,
    Concatenate,
    Final,
    Generic,
    Literal,
    LiteralString,
    Never,
    NoReturn,
    NotRequired,
    Optional,
    Required,
    Type,
    TypeAlias,
    TypeGuard,
    Union,
    Unpack,
)
import typing as tp
from typing_extensions import TypeForm, TypeIs, ReadOnly

type TA1 = int | str
type TA2[T] = list[T] | T
TA3: TypeAlias = Annotated[int, "meta"]
TA4 = int | str
type TA5[T] = int


def func1():
    t1 = int
    reveal_type(t1, expected_text="type[int]")

    t2 = int | str
    reveal_type(t2, expected_text="UnionType & TypeForm[int | str]")

    t3 = "int | str"
    reveal_type(t3, expected_text="Literal['int | str'] & TypeForm[int | str]")

    t4 = "int | 1"
    reveal_type(t4, expected_text="Literal['int | 1']")

    t5 = Annotated[int, "meta"]
    reveal_type(t5, expected_text="Annotated & TypeForm[int]")

    t5_alt1 = tp.Annotated[int, "meta"]
    reveal_type(t5_alt1, expected_text="Annotated & TypeForm[int]")

    t6 = Any
    reveal_type(t6, expected_text="type[Any]")

    t6_alt1 = tp.Any
    reveal_type(t6_alt1, expected_text="type[Any]")

    t7 = type[int]
    reveal_type(t7, expected_text="type[type[int]]")

    t7_alt = type
    reveal_type(t7_alt, expected_text="type[type]")

    t8 = TA1
    reveal_type(t8, expected_text="TypeAliasType & TypeForm[TA1]")

    t9 = TA2[str]
    reveal_type(t9, expected_text="TypeAliasType & TypeForm[TA2[str]]")

    t9_alt = TA2
    reveal_type(t9_alt, expected_text="TypeAliasType & TypeForm[TA2[Unknown]]")

    t10 = TA3
    reveal_type(t10, expected_text="Annotated & TypeForm[TA3]")

    t11 = TA4
    reveal_type(t11, expected_text="UnionType & TypeForm[TA4]")

    t12 = Literal[1, 2, 3]
    reveal_type(t12, expected_text="UnionType & TypeForm[Literal[1, 2, 3]]")

    t12_alt1 = tp.Literal[1, 2, 3]
    reveal_type(t12_alt1, expected_text="UnionType & TypeForm[Literal[1, 2, 3]]")

    t13 = Optional[str]
    reveal_type(t13, expected_text="UnionType & TypeForm[str | None]")

    t13_alt1 = tp.Optional[str]
    reveal_type(t13_alt1, expected_text="UnionType & TypeForm[str | None]")

    t14 = Union[list[int], str]
    reveal_type(t14, expected_text="UnionType & TypeForm[list[int] | str]")

    t14_alt1 = tp.Union[list[int], str]
    reveal_type(t14_alt1, expected_text="UnionType & TypeForm[list[int] | str]")

    t15 = TypeGuard[int]
    reveal_type(t15, expected_text="type[TypeGuard[int]]")

    t15_alt1 = tp.TypeGuard[int]
    reveal_type(t15_alt1, expected_text="type[TypeGuard[int]]")

    t16 = TypeIs[str]
    reveal_type(t16, expected_text="type[TypeIs[str]]")

    t17 = Callable[[int], None]
    reveal_type(t17, expected_text="Callable & TypeForm[(int) -> None]")

    t17_alt1 = tp.Callable[[int], None]
    reveal_type(t17_alt1, expected_text="Callable & TypeForm[(int) -> None]")

    t18 = list
    reveal_type(t18, expected_text="type[list[Unknown]]")
    reveal_type(t18[int], expected_text="type[list[int]]")

    t19 = list | dict
    reveal_type(
        t19,
        expected_text="UnionType & TypeForm[list[Unknown] | dict[Unknown, Unknown]]",
    )

    t20 = tuple
    reveal_type(t20, expected_text="type[tuple[Unknown, ...]]")
    reveal_type(t20[()], expected_text="type[tuple[()]]")
    reveal_type(t20[int, ...], expected_text="type[tuple[int, ...]]")

    t21 = tuple[()]
    reveal_type(t21, expected_text="type[tuple[()]]")

    t22 = tuple[int, *tuple[str, ...], int]
    reveal_type(t22, expected_text="type[tuple[int, *tuple[str, ...], int]]")

    t23 = TA5
    reveal_type(t23, expected_text="TypeAliasType & TypeForm[TA5[Unknown]]")

    t24 = str | None
    reveal_type(t24, expected_text="UnionType & TypeForm[str | None]")

    t25 = None
    reveal_type(t25, expected_text="None")


def func2[T](x: T) -> T:
    t1 = str | T
    reveal_type(t1, expected_text="UnionType & TypeForm[str | T@func2]")

    t2 = type[T]
    reveal_type(t2, expected_text="type[type[T@func2]]")

    return x


def func3[**P, R](x: Callable[P, R]) -> Callable[P, R]:
    t1 = Callable[Concatenate[int, P], R]
    reveal_type(t1, expected_text="Callable & TypeForm[(int, **P@func3) -> R@func3]")

    return x


def func4():
    t1 = Never
    reveal_type(t1, expected_text="type[Never]")

    t1_alt1 = tp.Never
    reveal_type(t1_alt1, expected_text="type[Never]")

    t2 = NoReturn
    reveal_type(t2, expected_text="type[NoReturn]")

    t3 = Type[int]
    reveal_type(t3, expected_text="type[Type[int]] & TypeForm[type[int]]")

    t3_alt1 = tp.Type[int]
    reveal_type(t3_alt1, expected_text="type[Type[int]] & TypeForm[type[int]]")


def func5():
    t1 = Generic
    reveal_type(t1, expected_text="type[Generic]")

    t2 = Final
    reveal_type(t2, expected_text="type[Final]")

    t3 = Final[int]
    reveal_type(t3, expected_text="type[Final]")

    t4 = Concatenate[int]
    reveal_type(t4, expected_text="type[Concatenate]")

    t5 = Unpack[int]
    reveal_type(t5, expected_text="type[Unpack]")

    t6 = Required[int]
    reveal_type(t6, expected_text="type[Required]")

    t7 = NotRequired[int]
    reveal_type(t7, expected_text="type[NotRequired]")

    t8 = ReadOnly[int]
    reveal_type(t8, expected_text="type[ReadOnly]")

    t9 = LiteralString
    reveal_type(t9, expected_text="type[LiteralString]")

    t10 = TypeForm[int | str]
    reveal_type(t10, expected_text="type[TypeForm[int | str]]")
