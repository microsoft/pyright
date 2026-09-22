# This sample tests that the value of an enum member assigned a tuple is
# the result of calling the enum's data type with the tuple's elements.

from enum import Enum, IntEnum, StrEnum


class BodyType1(str, Enum):
    # The value is the result of str("text"), which is the literal itself.
    Text = ("text",)
    Html = "html",
    Pair = "a", "b"


reveal_type(BodyType1.Text.value, expected_text="Literal['text']")
reveal_type(BodyType1.Text._value_, expected_text="Literal['text']")
reveal_type(BodyType1.Html.value, expected_text="Literal['html']")
reveal_type(BodyType1.Pair.value, expected_text="str")

v1: str = BodyType1.Text.value


class BodyType2(StrEnum):
    Text = ("text",)


reveal_type(BodyType2.Text.value, expected_text="Literal['text']")


class Number(int, Enum):
    One = (1,)
    Two = "2", 10


reveal_type(Number.One.value, expected_text="Literal[1]")
reveal_type(Number.Two.value, expected_text="int")


class Priority(IntEnum):
    Low = (1,)


reveal_type(Priority.Low.value, expected_text="Literal[1]")


class Plain(Enum):
    # A plain enum has no data type, so the value is the tuple itself.
    Point = (1, 2)


reveal_type(Plain.Point.value, expected_text="tuple[Literal[1], Literal[2]]")


class Custom(str, Enum):
    # A custom __new__ receives the tuple itself, so the value is not changed.
    def __new__(cls, value: str, label: str) -> "Custom":
        obj = str.__new__(cls, value)
        obj._value_ = value
        return obj

    A = ("a", "Label A")


reveal_type(Custom.A.value, expected_text="Any")


class Pairs(tuple[int, int], Enum):
    # A tuple data type receives the tuple itself.
    Origin = (0, 0)


reveal_type(Pairs.Origin.value, expected_text="tuple[Literal[0], Literal[0]]")


class Flag(int, Enum):
    # int(True) is 1, so the constructor converts the bool rather than
    # returning it unchanged; the value is an int, not Literal[True].
    Yes = (True,)


reveal_type(Flag.Yes.value, expected_text="int")


class Ratio(float, Enum):
    # float(1) is 1.0, so the int literal is likewise converted.
    Half = (1,)
    Whole = (1.0,)


reveal_type(Ratio.Half.value, expected_text="float")
reveal_type(Ratio.Whole.value, expected_text="float")

# Queue mixins initialize the enum member, but do not construct its value.
from queue import Queue, LifoQueue, PriorityQueue


class QueueEnum(Queue[int], Enum):
    Item = (1,)


class LifoEnum(LifoQueue[int], Enum):
    Item = (2,)


class PriorityEnum(PriorityQueue[int], Enum):
    Item = (3,)


reveal_type(QueueEnum.Item.value, expected_text="tuple[Literal[1]]")
reveal_type(LifoEnum.Item.value, expected_text="tuple[Literal[2]]")
reveal_type(PriorityEnum.Item.value, expected_text="tuple[Literal[3]]")


class ListEnum(list[int], Enum):
    Item = ([1, 2],)


class SetEnum(set[int], Enum):
    Item = ({1, 2},)


reveal_type(ListEnum.Item.value, expected_text="list[int]")
reveal_type(SetEnum.Item.value, expected_text="set[int]")
