# This sample tests the case where bidirectional type inference is required
# for the extra_items in a closed TypedDict.

from typing_extensions import TypedDict  # pyright: ignore[reportMissingModuleSource]


class Typed(TypedDict, extra_items=str | int):
    type: str


class Named(TypedDict, extra_items="str | int | Typed | Named"):
    name: str


td2_1: Named = {
    "name": "Fred",
    "birth": {
        "type": "date",
        "year": 2000,
        "month": 12,
        "day": 31,
    },
}

td2_2: Named = {
    "name": "Fred",
    "extra": {
        "name": "test",
        "value": "",
    },
}

td2_3: Named = {
    "name": "Fred",
}

td2_4: Named = {
    "name": "Fred",
    "test1": 1,
    "test2": {"name": "Barb", "value": {"type": "date", "day": 31}},
}
