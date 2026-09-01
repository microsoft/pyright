# This sample tests assignability rules for TypeForm types.

# pyright: reportMissingModuleSource=false

from dataclasses import InitVar
from typing import (
    Annotated,
    Any,
    Callable,
    ClassVar,
    Concatenate,
    Final,
    Generic,
    Literal,
    LiteralString,
    Never,
    NewType,
    NoReturn,
    NotRequired,
    Optional,
    Protocol,
    Required,
    Self,
    assert_type,
    Type,
    TypeAlias,
    TypeGuard,
    TypedDict,
    TypeVar,
    TypeVarTuple,
    Union,
    Unpack,
)
import typing
from typing_extensions import ReadOnly, TypeForm, TypeIs  # pyright: ignore[reportMissingModuleSource]

type TA1 = int | str
type TA2[T] = list[T] | T
TA3: TypeAlias = Annotated[int, "meta"]
TA4 = int | str
type TA5[T] = int

# TypeAlias is accepted as a nested type argument outside a TypeForm context.
ordinary_type_alias: list[TypeAlias]


def func1():
    t1: TypeForm[int | str] = int
    t2: TypeForm[int | str] = "int | str"
    t3: TypeForm[Any] = int | str
    t4: TypeForm = Annotated[int, "meta"]
    t5: TypeForm = Any
    t6: TypeForm = type[int]
    t7: TypeForm[Any] = type

    t8: TypeForm[TA1] = TA1
    t9: TypeForm[int | str] = TA1

    t10: TypeForm = TA2[str]
    t11: TypeForm[TA2[str]] = TA2[str]
    t12: TypeForm[list[Any] | str] = TA2[str]

    t13: TypeForm = TA2

    t14: TypeForm[int] = TA3

    t15: TypeForm = TA4

    t16: TypeForm[int] = Literal[1, 2, 3]

    t17: TypeForm[str | None] = Optional[str]

    t18: TypeForm = Union[list[int], str]

    t19: TypeForm[TypeGuard[Any]] = TypeGuard[int]
    t20: TypeForm = TypeIs[str]

    t21: TypeForm[Callable] = Callable[[int], None]

    t22: TypeForm[list[Any]] = list

    t24: TypeForm = list | dict

    t25: TypeForm = tuple

    t28: TypeForm = tuple[()]

    t29: TypeForm = tuple[int, *tuple[str, ...], int]
    t30: TypeForm = TA5

    t31: TypeForm = None
    t32: TypeForm = None | str

    def get_type() -> TypeForm[int]:
        return int

    t33: TypeForm = get_type()


def func2[T](x: T) -> T:
    t1: TypeForm[str | T | None] = str | T

    t2: TypeForm[Any] = type[T]

    return x


def func3[**P, R](x: Callable[P, R]) -> Callable[P, R]:
    t1: TypeForm = Callable[Concatenate[int, P], R]

    return x


def func4():
    t1: TypeForm[Never] = Never

    t2: TypeForm[Never] = NoReturn

    t3: TypeForm[type[int]] = Type[int]


NT1 = NewType("NT1", int)


def func5[**P, R]():
    t1: TypeForm[LiteralString] = typing.LiteralString
    t2: TypeForm = TypeForm[int | str]

    # This should generate an error because a ParamSpec isn't a valid
    # type expression on its own.
    t3: TypeForm = "P"

    t4: TypeForm = "typing.Callable"
    t5: TypeForm = "Union[int, str]"
    t6: TypeForm = NT1

    # These should generate errors because ParamSpecs and TypeVarTuples aren't
    # valid type expressions on their own.
    t7: TypeForm = P
    t8: TypeForm = Ts
    t9: TypeForm = "Ts"


T = TypeVar("T")
Ts = TypeVarTuple("Ts")


def func6[**P, R]():
    # This should generate an error.
    t1: TypeForm[int] = Generic

    # This should generate an error.
    t2: TypeForm[int] = Final

    # This should generate an error.
    t3: TypeForm[int] = Final[int]

    # This should generate an error.
    t4: TypeForm[int] = Concatenate[int]

    # This should generate an error.
    t5: TypeForm[int] = Unpack[int]

    # This should generate an error.
    t6: TypeForm[int] = Required[int]

    # This should generate an error.
    t7: TypeForm[int] = NotRequired[int]

    # This should generate an error.
    t8: TypeForm[int] = ReadOnly[int]

    var1 = 1
    # This should generate an error.
    t9: TypeForm = int | var1

    # This should generate an error.
    t10: TypeForm = "int + str"

    # This should generate an error.
    t11: TypeForm = "(int, str)"

    # This should generate an error.
    t12: TypeForm = "Q"

    # This should generate an error.
    t13: TypeForm = "Callable[P]"

    # This should generate an error.
    t14: TypeForm = "Callable[]"

    # This should generate an error.
    t15: TypeForm = "typing.Optional"

    # This should generate an error.
    t16: TypeForm = "Union[]"

    # This should generate an error.
    t17: TypeForm = "Union[int]"

    # This should generate an error.
    t18: TypeForm = "Annotated"

    # This should generate an error.
    t19: TypeForm = "T"

    # This should generate an error.
    t20: TypeForm = "int extra"


def func7():
    # This should generate an error.
    t1: TypeForm[Literal[""]] = typing.LiteralString

    # This should generate an error.
    t2: TypeForm[Never] = int

    # This should generate an error.
    t3: TypeForm[type[int]] = int

    # This should generate an error.
    t4: TypeForm[int] = type[int]


def func8[S, T: type](p1: TypeForm[Any], p2: TypeForm[int | str], p3: TypeForm[S]):
    t1: TypeForm = p1
    t2: TypeForm = p2
    t3: TypeForm = p3

    t4: TypeForm[int | str] = p2
    t5: TypeForm[int | str | None] = p2

    # This should generate an error.
    t6: TypeForm[int] = p2

    t7: TypeForm[S] = p3

    # This should generate an error.
    t8: TypeForm[T] = p3

    t9: TypeForm = S
    t10: TypeForm = T

    t11: TypeForm[S] = S
    t12: TypeForm[T] = T


def func9():
    t1: list[TypeForm[int | str]] = ["str | int", str]
    t1.append("bool")

    # This should generate an error.
    t1.append(complex)


def func10[T](x: type[T], y: type[int]):
    t1: TypeForm = x
    t2: TypeForm[T] = x

    t3: TypeForm = y
    t4: TypeForm[int] = y
    t5: TypeForm[float] = y


def func11():
    # This should generate an error because Self isn't valid outside a class.
    t1: TypeForm = Self

    # This should generate an error because ClassVar isn't valid in a TypeForm.
    t2: TypeForm = ClassVar[int]

    # This should generate an error because Final isn't valid in a TypeForm.
    t3: TypeForm = Final[int]

    # This should generate an error because Unpack isn't valid in this context.
    t4: TypeForm = Unpack[Ts]

    # This should generate an error because Optional requires a type argument.
    t5: TypeForm = Optional

    # These should generate errors because these bare special forms aren't
    # valid type expressions.
    t6: TypeForm = Protocol
    t7: TypeForm = TypedDict
    t8: TypeForm = TypeAlias
    t9: TypeForm = Literal

    # These should generate errors because forbidden qualifiers remain invalid
    # when nested within another type expression.
    t10: TypeForm = list[Final[int]]
    t11: TypeForm = list[Required[int]]

    # These bare special forms aren't valid type expressions.
    t12: TypeForm = TypeGuard
    t13: TypeForm = TypeIs
    t14: TypeForm = Union
    t15: TypeForm = Annotated
    t16: TypeForm = ClassVar
    t17: TypeForm = Required
    t18: TypeForm = NotRequired
    t19: TypeForm = ReadOnly
    t20: TypeForm = Unpack
    t21: TypeForm = Concatenate
    t22: TypeForm = Generic
    t23: TypeForm = Final

    # These should generate errors for an empty TypeForm argument list,
    # a nested annotation marker, and a dataclass-only annotation.
    t24: TypeForm = TypeForm[()]
    t25: TypeForm = list[TypeAlias]
    t26: TypeForm = InitVar[int]


class ClassWithSelf:
    def method(self):
        t1 = TypeForm(Self)
        assert_type(t1, TypeForm[Self])

        t2 = TypeForm("Self")
        assert_type(t2, TypeForm[Self])

        t3: TypeForm[Self] = "Self"

        t4 = TypeForm(list[Self])
        assert_type(t4, TypeForm[list[Self]])

        t5 = TypeForm("list[Self]")
        assert_type(t5, TypeForm[list[Self]])

        t6: TypeForm[list[Self]] = "list[Self]"


def func12[*ScopedTs]():
    # This should generate an error because a TypeVarTuple isn't a valid
    # type expression on its own.
    t1: TypeForm = ScopedTs
