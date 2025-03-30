# This sample tests the case involving nested calls that each use
# constrained TypeVars but one is a subset of the other.

from os import PathLike
from typing import Any, AnyStr, Literal, LiteralString, TypeVar, overload

AnyOrLiteralStr = TypeVar("AnyOrLiteralStr", str, bytes, LiteralString)


def abspath(path: PathLike[AnyStr] | AnyStr) -> AnyStr: ...


@overload
def dirname(p: PathLike[AnyStr]) -> AnyStr: ...


@overload
def dirname(p: AnyOrLiteralStr) -> AnyOrLiteralStr: ...


def dirname(p: Any) -> Any: ...


def func1(refpath: Literal["-"]):
    reveal_type(dirname(abspath(refpath)), expected_text="str")
