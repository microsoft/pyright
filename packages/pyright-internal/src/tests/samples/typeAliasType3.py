# This sample tests a TypeAliasType whose value refers to TypedDict
# and NamedTuple classes that refer back to the type alias.

from typing import NamedTuple, TypedDict
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeAliasType,
)


class TD1(TypedDict):
    a: "TDAlias"


class TD2(TypedDict):
    b: "TDAlias"


class NT1(NamedTuple):
    a: "NTAlias"


class NT2(NamedTuple):
    b: "NTAlias"


TDAlias = TypeAliasType("TDAlias", TD1 | TD2)
NTAlias = TypeAliasType("NTAlias", NT1 | NT2)


def func1(td1: TD1, td2: TD2, nt1: NT1, nt2: NT2) -> None:
    reveal_type(td1["a"], expected_text="TD1 | TD2")
    reveal_type(td2["b"], expected_text="TD1 | TD2")
    reveal_type(nt1.a, expected_text="NT1 | NT2")
    reveal_type(nt2.b, expected_text="NT1 | NT2")
