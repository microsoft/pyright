# This sample tests special forms that are not compatible with type[T],
# type[object] or type[Any].

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
    TypeVar,
    Union,
    Unpack,
)
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]

T = TypeVar("T")


def func1(val: type[Any]) -> None:
    pass


def func2(val: type[object]) -> None:
    pass


def func3(val: type[T]) -> None:
    pass


# The following should all generate an error.
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
func1(Optional[Any])
func1(LiteralString)
func1(Self)
func1(Concatenate)
func1(TypeAlias)
func1(TypeGuard)
func1(Annotated)
func1(ReadOnly)
func1(Union[int, str])
func1(int | str)
func1(Any)

func2(Literal)
func2(Literal[0])
func2(ClassVar)
func2(Unpack)
func2(Required)
func2(NotRequired)
func2(Protocol)
func2(Generic)
func2(Final)
func2(Callable)
func2(Callable[..., Any])
func2(Union)
func2(Optional)
func2(Optional[Any])
func2(LiteralString)
func2(Self)
func2(Concatenate)
func2(TypeAlias)
func2(TypeGuard)
func2(Annotated)
func2(ReadOnly)
func2(Union[int, str])
func2(int | str)
func2(Any)

func3(Literal)
func3(Literal[0])
func3(ClassVar)
func3(Unpack)
func3(Required)
func3(NotRequired)
func3(Protocol)
func3(Generic)
func3(Final)
func3(Callable)
func3(Callable[..., Any])
func3(Union)
func3(Optional)
func3(Optional[Any])
func3(LiteralString)
func3(Self)
func3(Concatenate)
func3(TypeAlias)
func3(TypeGuard)
func3(Annotated)
func3(ReadOnly)
func3(Union[int, str])
func3(int | str)
func3(Any)
