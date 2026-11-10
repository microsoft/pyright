from enum import EJECT, IntEnum, IntFlag
from typing import Callable, Literal, TypedDict


class Intercepted(IntFlag, boundary=EJECT):
    A = 1

    def __getattribute__(self, name: str) -> object:
        return 8 if name == "_value_" else super().__getattribute__(name)


class AccessMixin:
    def __getattribute__(self, name: str) -> object:
        return 8 if name == "_value_" else super().__getattribute__(name)


class Inherited(AccessMixin, IntFlag, boundary=EJECT):
    A = 1


class InterceptedNegative(AccessMixin, IntFlag, boundary=EJECT):
    A = -1


class OtherArgs(TypedDict):
    other: Literal[1]


def intercepted():
    reveal_type(1 | Intercepted.A, expected_text="int")
    reveal_type(1 ^ Intercepted.A, expected_text="int")
    reveal_type(Intercepted.A | 1, expected_text="int")
    reveal_type(Intercepted.A.__or__(1), expected_text="int")
    reveal_type(Intercepted.__or__(Intercepted.A, 1), expected_text="int")
    reveal_type(Intercepted.A & 8, expected_text="int")
    # These should generate errors: the operation reads 8 rather than the assigned 1.
    (1 | Intercepted.A).name
    (1 ^ Intercepted.A).name
    (Intercepted.A | 1).name
    Intercepted.A.__or__(1).name
    Intercepted.__or__(Intercepted.A, 1).name
    (Intercepted.A & 8).name
    bound = Intercepted.A.__or__
    bound(1).name
    arguments: OtherArgs = {"other": 1}
    bound(**arguments).name


def inherited():
    reveal_type(1 | Inherited.A, expected_text="int")
    reveal_type(1 ^ Inherited.A, expected_text="int")
    # These should generate errors: inherited access interception is equally unsafe.
    (1 | Inherited.A).name
    (1 ^ Inherited.A).name
    Inherited.A.__xor__(1).name
    (InterceptedNegative.A | 1).name


def intercepted_callback() -> Callable[[Literal[1]], Intercepted]:
    # This should generate an error: the callback returns int(9).
    return Intercepted.A.__or__


def inherited_callback() -> Callable[[Literal[1]], Inherited]:
    # This should generate an error: the inherited callback returns int(9).
    return Inherited.A.__xor__


class OrdinaryMixin:
    description = "ordinary"

    def __getattr__(self, name: str) -> object:
        raise AttributeError(name)


class Ordinary(OrdinaryMixin, IntFlag, boundary=EJECT):
    A = 1


def ordinary() -> Callable[[Literal[1]], Ordinary]:
    reveal_type(1 | Ordinary.A, expected_text="Ordinary")
    reveal_type(Ordinary.A.__or__(1), expected_text="Ordinary")
    reveal_type((1 | Ordinary.A).name, expected_text="str | None")
    # This should generate an error: ordinary storage does not make bit 8 valid.
    (Ordinary.A | 8).name
    return Ordinary.A.__or__


class PayloadEnum(AccessMixin, IntEnum):
    TWO = 2


class OnlyTwo(IntFlag, boundary=EJECT):
    TWO = 2


def numeric_payload() -> Callable[[Literal[PayloadEnum.TWO]], OnlyTwo]:
    # Builtin int reflection uses the numeric payload, not intercepted attribute access.
    reveal_type(OnlyTwo.TWO | PayloadEnum.TWO, expected_text="OnlyTwo")
    reveal_type((OnlyTwo.TWO | PayloadEnum.TWO).name, expected_text="str | None")
    return OnlyTwo.TWO.__or__


class Negative(IntFlag, boundary=EJECT):
    A = -1


def negative_operator() -> Negative:
    reveal_type(Negative.A | 1, expected_text="Negative")
    reveal_type(1 | Negative.A, expected_text="Negative")
    reveal_type(Negative.A | Negative.A, expected_text="Negative")
    reveal_type(Negative.A & -1, expected_text="Negative")
    reveal_type(Negative.A ^ 0, expected_text="Negative")
    reveal_type(Negative.A ^ 1, expected_text="int")
    return Negative.A | 1


def negative_bound() -> Negative:
    bound = Negative.A.__or__
    reveal_type(bound(1), expected_text="Negative")
    reveal_type(Negative.A.__or__(1), expected_text="Negative")
    return bound(1)


def negative_unbound() -> Negative:
    reveal_type(Negative.__or__(Negative.A, 1), expected_text="Negative")
    return Negative.__or__(Negative.A, 1)


def negative_callback() -> Callable[[Literal[1]], Negative]:
    return Negative.A.__or__


def negative_zero_callback() -> Callable[[Literal[0]], Negative]:
    return Negative.A.__xor__


def negative_member_callback() -> Callable[[Literal[Negative.A]], Negative]:
    return Negative.A.__or__


def negative_packed() -> Negative:
    arguments: tuple[Literal[Negative.A], Literal[1]] = (Negative.A, 1)
    return Negative.__or__(*arguments)


def negative_xor() -> Negative:
    # This should generate an error: -1 ^ 1 is the unknown value -2 and ejects.
    return Negative.A ^ 1


def negative_direct_xor() -> Negative:
    # This should generate an error for the same operation called directly.
    return Negative.A.__xor__(1)


def negative_xor_callback() -> Callable[[Literal[1]], Negative]:
    # This should generate an error: a known member does not make XOR1 safe.
    return Negative.A.__xor__


def negative_general(value: int):
    reveal_type(Negative.A | value, expected_text="int")
    reveal_type(Negative.A & value, expected_text="int")
