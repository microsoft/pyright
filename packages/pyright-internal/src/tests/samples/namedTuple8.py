# This sample tests the case where a NamedTuple class is generic.

from typing import AnyStr, Generic, NamedTuple


class GenericNT(NamedTuple, Generic[AnyStr]):
    scheme: AnyStr


class SpecializedNT(GenericNT[str]):
    def geturl(self) -> str: ...


def func(x: SpecializedNT):
    reveal_type(x.__iter__, expected_text="() -> Iterator[str]")
    reveal_type(list(x), expected_text="list[str]")
