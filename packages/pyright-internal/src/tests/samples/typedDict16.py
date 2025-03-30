# This sample tests that type compatibility between TypedDicts.

from typing import TypedDict, final


class TD0(TypedDict):
    key: str


class TD1(TD0):
    value: str


class TD2(TypedDict):
    key: str
    value: str


v1: TD2 = TD1(key="", value="")
v2: TD1 = TD2(key="", value="")

v3 = [v2]
v4: list[TD2] = v3
v5 = [v1]
v6: list[TD1] = v5


class TD10(TypedDict, total=False):
    key: str


class TD11(TD10):
    value: str


class TD12(TypedDict):
    key: str
    value: str


# This should generate an error.
v10: TD12 = TD11(key="", value="")

# This should generate an error.
v11: TD11 = TD12(key="", value="")


v12 = [v10]
# This should generate an error.
v13: list[TD10] = v12

v14 = [v11]
# This should generate an error.
v15: list[TD12] = v14


class TD20(TypedDict):
    key: str
    value: str


class TD21(TypedDict):
    key: str
    value: str
    extra: str


# This should generate an error.
v20: TD21 = TD20(key="", value="")

v21: TD20 = TD21(key="", value="", extra="")


v22 = [v20]
# This should generate an error.
v23: list[TD20] = v22

v24: list[TD20] = [v21]
# This should generate an error.
v25: list[TD21] = v24
