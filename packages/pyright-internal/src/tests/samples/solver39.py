# This sample tests the case where an overloaded function is passed as
# an argument and the overloads cannot be filtered during the first
# pass through the arguments.

from functools import reduce
from operator import getitem
from typing import Any


def deep_getitem(data: dict[str, Any], attr: str) -> Any:
    return reduce(getitem, attr.split("."), data)
