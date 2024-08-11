# This sample tests the case where bidirectional type inference is required
# for the __extra_items__ in a closed TypedDict.

from typing_extensions import TypedDict  # pyright: ignore[reportMissingModuleSource]


class Typed(TypedDict, closed=True):
    type: str
    __extra_items__: str | int


class Named(TypedDict, closed=True):
    name: str
    __extra_items__: "str | int | Typed | Named"


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
