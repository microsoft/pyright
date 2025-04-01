# This sample tests the case where a lambda's expected type is incomplete
# the first time it is evaluated.

from typing import Callable, Generic, TypeVar, cast, overload


_OutT = TypeVar("_OutT")
_Out2T = TypeVar("_Out2T", bound=str)


class Flow(Generic[_OutT]):
    @overload
    def map(self, func: Callable[[_OutT], Exception], /) -> "Flow[None]": ...

    @overload
    def map(self, func: Callable[[_OutT], _Out2T], /) -> "Flow[_Out2T]": ...

    def map(self, obj, /):
        return cast("Flow", self)


class Data: ...


x1 = Flow[Data]().map(lambda aa: _get_date(reveal_type(aa, expected_text="Data")))
reveal_type(x1, expected_text="Flow[str]")

x2 = x1.map(lambda bb: reveal_type(bb, expected_text="str"))
reveal_type(x2, expected_text="Flow[str]")

x3 = x2.map(lambda cc: "any value")
reveal_type(x3, expected_text="Flow[str]")


def _get_date(d: Data) -> str: ...
