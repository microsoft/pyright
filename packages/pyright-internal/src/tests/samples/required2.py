# This sample tests the handling of Required and NotRequired
# (PEP 655) in TypedDict definitions.

# pyright: reportMissingModuleSource=false

from typing import Literal, TypedDict, Annotated
import typing_extensions as te
from typing_extensions import Required, NotRequired


class TD1(TypedDict, total=False):
    a: Annotated["te.Required[int]", ""]
    b: Annotated[te.NotRequired[str], ""]
    c: "te.Required[int | str]"
    d: te.Required[str | None]
    e: Required[Literal[1, 2, 3]]
    f: Required[None]
    g: Required[type[int]]


td1_1: TD1 = {"a": 3, "c": "hi", "d": None, "e": 3, "f": None, "g": int}

# This should generate an error because a is missing.
td1_2: TD1 = {"c": "hi", "d": None, "e": 3, "f": None, "g": int}

# This should generate an error because c is missing.
td1_3: TD1 = {"a": 3, "d": None, "e": 3, "f": None, "g": int}

# This should generate an error because d is missing.
td1_4: TD1 = {"a": 3, "c": "hi", "e": 3, "f": None, "g": int}

# This should generate an error because e is missing.
td1_5: TD1 = {"a": 3, "c": "hi", "d": None, "f": None, "g": int}

# This should generate an error because f is missing.
td1_6: TD1 = {"a": 3, "c": "hi", "d": None, "e": 3, "g": int}

# This should generate an error because g is missing.
td1_7: TD1 = {"a": 3, "c": "hi", "d": None, "e": 3, "f": None}


class TD2(TypedDict, total=True):
    a: Required[int]
    b: NotRequired[str]
    c: Required[int | str]
    d: NotRequired[str | None]
    e: NotRequired[Literal[1, 2, 3]]
    f: NotRequired[None]
    g: NotRequired[type[int]]


td2_1: TD2 = {"a": 3, "c": "hi", "d": None, "e": 3, "f": None, "g": int}

td2_2: TD2 = {"a": 3, "c": "hi"}

# This should generate an error because c is missing.
td2_3: TD2 = {"a": 3}
