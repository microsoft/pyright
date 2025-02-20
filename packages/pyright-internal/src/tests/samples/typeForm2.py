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
    TypeVar,
    Union,
    Unpack,
)
import typing as tp
from typing_extensions import TypeForm, TypeIs, ReadOnly

T = TypeVar("T")

type TA1 = int | str
type TA2[T] = list[T] | T
TA3: TypeAlias = Annotated[int, "meta"]
TA4 = int | str
type TA5[T] = int


def tf[T](x: TypeForm[T]) -> TypeForm[T]: ...


def func1():
    t1 = tf(int)
    reveal_type(t1, expected_text="TypeForm[int]")

    t2 = tf(int | str)
    reveal_type(t2, expected_text="TypeForm[int | str]")

    t3 = tf("int | str")
    reveal_type(t3, expected_text="TypeForm[int | str]")

    t5 = tf(Annotated[int, "meta"])
    reveal_type(t5, expected_text="TypeForm[int]")

    t5_alt1 = tf(tp.Annotated[int, "meta"])
    reveal_type(t5_alt1, expected_text="TypeForm[int]")

    t6 = tf(Any)
    reveal_type(t6, expected_text="TypeForm[Any]")

    t6_alt1 = tf(tp.Any)
    reveal_type(t6_alt1, expected_text="TypeForm[Any]")

    t7 = tf(type[int])
    reveal_type(t7, expected_text="TypeForm[type[int]]")

    t7_alt = tf(type)
    reveal_type(t7_alt, expected_text="TypeForm[type]")

    t8 = tf(TA1)
    reveal_type(t8, expected_text="TypeForm[int | str]")

    t9 = tf(TA2[str])
    reveal_type(t9, expected_text="TypeForm[list[str] | str]")

    t9_alt = tf(TA2)
    reveal_type(t9_alt, expected_text="TypeForm[list[T@TA2] | T@TA2]")

    t10 = tf(TA3)
    reveal_type(t10, expected_text="TypeForm[int]")

    t11 = tf(TA4)
    reveal_type(t11, expected_text="TypeForm[int | str]")

    t12 = tf(Literal[1, 2, 3])
    reveal_type(t12, expected_text="TypeForm[Literal[1, 2, 3]]")

    t12_alt1 = tf(tp.Literal[1, 2, 3])
    reveal_type(t12_alt1, expected_text="TypeForm[Literal[1, 2, 3]]")

    t13 = tf(Optional[str])
    reveal_type(t13, expected_text="TypeForm[str | None]")

    t13_alt1 = tf(tp.Optional[str])
    reveal_type(t13_alt1, expected_text="TypeForm[str | None]")

    t14 = tf(Union[list[int], str])
    reveal_type(t14, expected_text="TypeForm[list[int] | str]")

    t14_alt1 = tf(tp.Union[list[int], str])
    reveal_type(t14_alt1, expected_text="TypeForm[list[int] | str]")

    t15 = tf(TypeGuard[int])
    reveal_type(t15, expected_text="TypeForm[TypeGuard[int]]")

    t15_alt1 = tf(tp.TypeGuard[int])
    reveal_type(t15_alt1, expected_text="TypeForm[TypeGuard[int]]")

    t16 = tf(TypeIs[str])
    reveal_type(t16, expected_text="TypeForm[TypeIs[str]]")

    t17 = tf(Callable[[int], None])
    reveal_type(t17, expected_text="TypeForm[(int) -> None]")

    t17_alt1 = tf(tp.Callable[[int], None])
    reveal_type(t17_alt1, expected_text="TypeForm[(int) -> None]")

    t18 = list
    reveal_type(tf(t18), expected_text="TypeForm[list[Unknown]]")
    reveal_type(tf(t18[int]), expected_text="TypeForm[list[int]]")

    t19 = tf(list | dict)
    reveal_type(
        t19,
        expected_text="TypeForm[list[Unknown] | dict[Unknown, Unknown]]",
    )

    t20 = tuple
    reveal_type(tf(t20), expected_text="TypeForm[tuple[Unknown, ...]]")
    reveal_type(tf(t20[()]), expected_text="TypeForm[tuple[()]]")
    reveal_type(tf(t20[int, ...]), expected_text="TypeForm[tuple[int, ...]]")

    t21 = tf(tuple[()])
    reveal_type(t21, expected_text="TypeForm[tuple[()]]")

    t22 = tf(tuple[int, *tuple[str, ...], int])
    reveal_type(t22, expected_text="TypeForm[tuple[int, *tuple[str, ...], int]]")

    t23 = tf(TA5)
    reveal_type(t23, expected_text="TypeForm[int]")

    t24 = tf(str | None)
    reveal_type(t24, expected_text="TypeForm[str | None]")

    t25 = tf(None)
    reveal_type(t25, expected_text="TypeForm[None]")

    t26 = tf(LiteralString)
    reveal_type(t26, expected_text="TypeForm[LiteralString]")


def func2[T](x: T) -> T:
    t1 = tf(str | T)
    reveal_type(t1, expected_text="TypeForm[str | T@func2]")

    t2 = tf(type[T])
    reveal_type(t2, expected_text="TypeForm[type[T@func2]]")

    return x


def func3[**P, R](x: Callable[P, R]) -> Callable[P, R]:
    t1 = tf(Callable[Concatenate[int, P], R])
    reveal_type(t1, expected_text="TypeForm[(int, **P@func3) -> R@func3]")

    return x


def func4():
    t1 = tf(Never)
    reveal_type(t1, expected_text="TypeForm[Never]")

    t1_alt1 = tf(tp.Never)
    reveal_type(t1_alt1, expected_text="TypeForm[Never]")

    t2 = tf(NoReturn)
    reveal_type(t2, expected_text="TypeForm[NoReturn]")

    t3 = tf(Type[int])
    reveal_type(t3, expected_text="TypeForm[type[int]]")

    t3_alt1 = tf(tp.Type[int])
    reveal_type(t3_alt1, expected_text="TypeForm[type[int]]")


def func5():
    t1 = tf(TypeForm[int | str])
    reveal_type(t1, expected_text="TypeForm[TypeForm[int | str]]")

    t2 = tf(TypeForm[TypeForm[int | str]])
    reveal_type(t2, expected_text="TypeForm[TypeForm[TypeForm[int | str]]]")


def func6(x: T) -> T:
    v1: TypeForm[T] = T
    v2 = tf(T)
    reveal_type(v2, expected_text="TypeForm[T@func6]")

    v3: TypeForm[T | int] = T
    v3 = T | int

    v4 = tf(T | int)
    reveal_type(v4, expected_text="TypeForm[T@func6 | int]")

    v5: TypeForm[list[T]] = list[T]

    v6 = tf(list[T])
    reveal_type(v6, expected_text="TypeForm[list[T@func6]]")

    return x


# These should maybe generage errors, but given
# that the typing spec doesn't say anything about how
# to evaluate the type of a special form when it's used
# in a value expression context, it's not clear.
def func7():
    t1 = tf(Generic)

    t2 = tf(Final)

    t3 = tf(Final[int])

    t4 = tf(Concatenate[int])

    t5 = tf(Unpack[int])

    t6 = tf(Required[int])

    t7 = tf(NotRequired[int])

    t8 = tf(ReadOnly[int])
