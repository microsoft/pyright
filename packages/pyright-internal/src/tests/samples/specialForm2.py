# This sample tests special forms and their use as runtime objects.

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
    NotRequired,
    Optional,
    Protocol,
    Required,
    Self,
    TypeAlias,
    TypeGuard,
    TypedDict,
    Union,
    Unpack,
)


def func1(val: object) -> None:
    pass


# All of these should be compatible with `object`, and they
# should not generate errors.
func1(Literal)
func1(Literal[0])
func1(ClassVar)
func1(Unpack)
func1(Required)
func1(NotRequired)
func1(Protocol)
func1(Generic)
func1(Final)
func1(Callable)
func1(Callable[..., Any])
func1(Union)
func1(Optional)
func1(TypedDict)
func1(LiteralString)
func1(Self)
func1(Concatenate)
func1(TypeAlias)
func1(TypeGuard)
func1(Annotated)
func1(Union[int, str])
func1(int | str)


{Literal[1]: "literal"}[Literal[1]]
