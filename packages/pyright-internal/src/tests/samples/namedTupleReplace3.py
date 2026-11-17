# This sample tests canonical field names for renamed NamedTuple factories.

from collections import namedtuple


DuplicateString = namedtuple("DuplicateString", " x, x ", rename=True, defaults=(0,))
duplicate_string = DuplicateString(x=1, _1=2)
reveal_type(duplicate_string._replace(_1=3), expected_text="DuplicateString")
reveal_type(
    DuplicateString.__match_args__, expected_text="tuple[Literal['x'], Literal['_1']]"
)
reveal_type(DuplicateString(x=1), expected_text="DuplicateString")

# This should generate an error.
duplicate_string._replace(_2=3)


DuplicateList = namedtuple("DuplicateList", ["x", "x"], rename=True)
duplicate_list = DuplicateList(x=1, _1=2)
reveal_type(duplicate_list._replace(_1=3), expected_text="DuplicateList")
reveal_type(
    DuplicateList.__match_args__, expected_text="tuple[Literal['x'], Literal['_1']]"
)


DuplicateTuple = namedtuple("DuplicateTuple", ("x", "x"), rename=True)
duplicate_tuple = DuplicateTuple(x=1, _1=2)
reveal_type(duplicate_tuple._replace(_1=3), expected_text="DuplicateTuple")


InvalidString = namedtuple("InvalidString", "x bad-name 3x", rename=True)
invalid_string = InvalidString(x=1, _1=2, _2=3)
reveal_type(invalid_string._replace(_1=4, _2=5), expected_text="InvalidString")
reveal_type(
    InvalidString.__match_args__,
    expected_text="tuple[Literal['x'], Literal['_1'], Literal['_2']]",
)


InvalidList = namedtuple(
    "InvalidList", ["x", "bad-name", "class", "_private", "", "x", "match", "type"], rename=True
)
invalid_list = InvalidList(x=1, _1=2, _2=3, _3=4, _4=5, _5=6, match=7, type=8)
reveal_type(
    invalid_list._replace(_1=9, _2=10, _3=11, _4=12, _5=13, match=14, type=15),
    expected_text="InvalidList",
)
reveal_type(
    InvalidList.__match_args__,
    expected_text="tuple[Literal['x'], Literal['_1'], Literal['_2'], Literal['_3'], Literal['_4'], Literal['_5'], Literal['match'], Literal['type']]",
)

# This should generate an error.
invalid_list._replace(_8=1)
