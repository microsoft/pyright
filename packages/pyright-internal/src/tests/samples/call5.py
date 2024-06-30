# This sample tests handling of unpack operators used
# for arguments that are of a specified length (specifically,
# tuples with a specified list of elements types).

from typing import NamedTuple, List, Tuple

X = NamedTuple("X", [("a", int), ("b", str), ("c", str)])

q0: List[Tuple[int, str, str]] = [(1, "", ""), (2, "", "")]

[X(*item) for item in q0]


q1: List[Tuple[int, str, float]] = [(1, "a", 3), (2, "b", 4), (3, "c", 5)]

# This should generate an error because the items in q1 are not the
# right type for the X constructor.
[X(*item) for item in q1]


q2: List[Tuple[int, str]] = [(1, "1"), (2, "2"), (3, "3")]

# This should generate an error because the items in q2 contain only
# two elements, and we need three to populate all three parameters
# in the X constructor.
[X(*item) for item in q2]


q3: List[Tuple[int, str, str, float]] = [
    (1, "a", "3", 4),
    (2, "b", "4", 5),
    (3, "c", "5", 6),
]

# This should generate an error because the items in q3 contain
# four elements, and we need three to populate all parameters
# in the X constructor.
[X(*item) for item in q3]


q4: List[Tuple[int, ...]] = [
    (1, 3),
    (2, 5),
    (3, 6),
]

# This should generate two errors because it isn't assignable to parameter
# b or c.
[X(*item) for item in q4]


Y = NamedTuple("Y", [("a", str), ("b", str), ("c", str)])

q5: List[Tuple[str, ...]] = [
    ("a", "b"),
    ("a", "b"),
]

[Y(*item) for item in q5]


class Z(NamedTuple):
    a: list[str]
    b: list[int]


q6 = Z(["1"], [3])

for a, b in zip(*q6):
    reveal_type(a, expected_text="str")
    reveal_type(b, expected_text="int")


def func1(a: list[str], c: list[int]): ...


func1(*q6)


class ABC(NamedTuple):
    a: float
    b: float
    c: float

    def to_rgba(self) -> "ABC":
        return ABC(*self)


class AB(NamedTuple):
    a: float
    b: float

    def to_abc(self) -> ABC:
        return ABC(*self, 1)
