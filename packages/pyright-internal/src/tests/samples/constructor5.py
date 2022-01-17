# This sample tests the case where a constructor
# (in this case, OrderedDict) accepts a dict expression
# that is matched against a protocol in the OrderedDict
# constructor.

from typing import OrderedDict


val1 = {
    "a": 1,
    "b": 0,
}
reveal_type(val1, expected_text="dict[str, int]")

val2 = OrderedDict(val1)
reveal_type(val2, expected_text="OrderedDict[str, int]")


val3 = OrderedDict(
    {
        "a": 1,
        "b": 0,
    }
)
reveal_type(val3, expected_text="OrderedDict[str, int]")
