# This sample tests the handling of dictionary expansion for TypedDicts.

from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    NotRequired,
    Required,
    TypedDict,
)


class TD1(TypedDict):
    v1: Required[int]


class TD2(TypedDict):
    v2: Required[str]


class TD3(TypedDict):
    v1: NotRequired[int]


class TD4(TD1, TD2): ...


td1: TD1 = {"v1": 0}
td2: TD2 = {"v2": ""}
td3_1: TD3 = {}
td3_2: TD3 = {"v1": 0}

td4_1: TD4 = {**td1, **td2}

# This should generate an error because td3_1
# does not include the required "v1" entry.
td4_2: TD4 = {**td3_1, **td2}

td4_3: TD4 = {**td3_2, **td2}
