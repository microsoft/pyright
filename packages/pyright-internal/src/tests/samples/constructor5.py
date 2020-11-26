# This sample tests the case where a constructor
# (in this case, OrderedDict) accepts a dict expression
# that is matched against a protocol in the OrderedDict
# constructor.

from typing import Literal, OrderedDict


val1 = {
    "a": 1,
    "b": 0,
}
t1: Literal["dict[str, int]"] = reveal_type(val1)

val2 = OrderedDict(val1)
t2: Literal["OrderedDict[str, int]"] = reveal_type(val2)


val3 = OrderedDict(
    {
        "a": 1,
        "b": 0,
    }
)
t3: Literal["OrderedDict[str, int]"] = reveal_type(val3)
