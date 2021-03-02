# This sample tests the handling of Required and NotRequired
# (PEP 655) in TypedDict definitions.

from typing import Literal, NotRequired, Optional, Required, Type, TypedDict


class TD1(TypedDict, total=False):
    a: Required[int]
    b: NotRequired[str]
    c: Required[int | str]
    d: Required[Optional[str]]
    e: Required[Literal[1, 2, 3]]
    f: Required[None]
    g: Required[Type[int]]


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
    d: NotRequired[Optional[str]]
    e: NotRequired[Literal[1, 2, 3]]
    f: NotRequired[None]
    g: NotRequired[Type[int]]


td2_1: TD2 = {"a": 3, "c": "hi", "d": None, "e": 3, "f": None, "g": int}

td2_2: TD2 = {"a": 3, "c": "hi"}

# This should generate an error because c is missing.
td2_3: TD2 = {"a": 3}
