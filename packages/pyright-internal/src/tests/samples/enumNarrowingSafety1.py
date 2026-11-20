from enum import EnumType, IntEnum, IntFlag, StrEnum, unique
from typing import Any, Literal, TypeVar, assert_type


def number() -> int:
    return 7


def text() -> str:
    return "a"


class Mixed(IntEnum):
    ONE = 1
    COMPUTED = number()
    THREE = 3


class MixedText(StrEnum):
    ALPHA = "a"
    COMPUTED = text()
    GAMMA = "c"


class Source(IntEnum):
    VALUE = number()


class Nested(IntEnum):
    VALUE = Source.VALUE


class StringSource(StrEnum):
    VALUE = text()


class StringNested(StrEnum):
    VALUE = StringSource.VALUE


class KnownSource(IntEnum):
    VALUE = 7


class KnownNested(IntEnum):
    VALUE = KnownSource.VALUE


class BooleanValue(IntEnum):
    COMPUTED = number()
    TRUE = True
    THREE = 3


@unique
class Decorated(IntEnum):
    ONE = 1
    COMPUTED = number()
    THREE = 3


class CustomEq(IntEnum):
    ONE = 1
    COMPUTED = number()
    THREE = 3

    def __eq__(self, value: object) -> bool:
        return (int(self) == 3 and value == 1) or bool(int.__eq__(self, value))

    __hash__ = int.__hash__


class CustomNe(IntEnum):
    ONE = 1
    COMPUTED = number()
    THREE = 3

    def __ne__(self, value: object) -> bool:
        return not (int(self) == 3 and value == 1) and bool(int.__ne__(self, value))


class CustomNew(IntEnum):
    def __new__(cls, raw: int):
        value = 10 if raw == 1 else 1 if raw == 3 else raw
        member = int.__new__(cls, value)
        member._value_ = value
        return member

    ONE = 1
    COMPUTED = number()
    THREE = 3


class Flag(IntFlag):
    ONE = 1
    TWO = 2


def accept_possible(value: Literal[Mixed.ONE, Mixed.COMPUTED]) -> None:
    pass


def accept_one(value: Literal[Mixed.ONE]) -> None:
    pass


def accept_text(value: Literal[MixedText.ALPHA, MixedText.COMPUTED]) -> None:
    pass


def test_mixed(value: Mixed) -> None:
    if value == 1:
        assert_type(value, Literal[Mixed.ONE, Mixed.COMPUTED])
        accept_possible(value)
        accept_one(value)  # This should generate an error.
    else:
        assert_type(value, Literal[Mixed.COMPUTED, Mixed.THREE])


def test_inequality(value: Mixed) -> None:
    if value != 1:
        assert_type(value, Literal[Mixed.COMPUTED, Mixed.THREE])
    else:
        assert_type(value, Literal[Mixed.ONE, Mixed.COMPUTED])
        accept_possible(value)


def test_unknown_match_only(value: Mixed) -> None:
    if value == 9:
        assert_type(value, Literal[Mixed.COMPUTED])


def test_text(value: MixedText) -> None:
    if value == "a":
        assert_type(value, Literal[MixedText.ALPHA, MixedText.COMPUTED])
        accept_text(value)
    else:
        assert_type(value, Literal[MixedText.COMPUTED, MixedText.GAMMA])


def test_nested(value: Literal[Nested.VALUE]) -> int:
    if value == 7:
        assert_type(value, Literal[Nested.VALUE])
        return "reachable"  # This should generate an error.
    assert_type(value, Literal[Nested.VALUE])
    return 0


def test_nested_text(value: Literal[StringNested.VALUE]) -> int:
    if value == "a":
        assert_type(value, Literal[StringNested.VALUE])
        return "reachable"  # This should generate an error.
    assert_type(value, Literal[StringNested.VALUE])
    return 0


def test_reverse_nested(flag: bool) -> int:
    value = 7 if flag else 9
    if value == Nested.VALUE:
        assert_type(value, Literal[7, 9])
        return "reachable"  # This should generate an error.
    assert_type(value, Literal[7, 9])
    return 0


def test_known_nested_nonmatch(value: Literal[KnownNested.VALUE]) -> int:
    if value == 9:
        return "unreachable"
    return 0


def test_boolean_value(value: BooleanValue) -> None:
    if value == 1:
        assert_type(value, Literal[BooleanValue.COMPUTED, BooleanValue.TRUE])


def test_decorated(value: Decorated) -> None:
    if value == 1:
        assert_type(value, Decorated)


def test_custom_equality(value: CustomEq) -> None:
    if value == 1:
        assert_type(value, CustomEq)


def test_custom_inequality(value: CustomNe) -> None:
    if value != 1:
        pass
    else:
        assert_type(value, CustomNe)


def test_custom_construction(value: CustomNew) -> None:
    if value == 1:
        assert_type(value, CustomNew)


def test_flag(value: Flag) -> None:
    if value == 1:
        assert_type(value, Flag)
    else:
        assert_type(value, Flag)


class DeepNested(IntEnum):
    VALUE = Nested.VALUE


class KnownOne(IntEnum):
    VALUE = 1


class NestedAndUnknown(IntEnum):
    COMPUTED = number()
    NESTED = KnownOne.VALUE
    THREE = 3


class CustomMeta(EnumType):
    pass


class MetaEnum(IntEnum, metaclass=CustomMeta):
    ONE = 1
    COMPUTED = number()
    THREE = 3


def test_deep_nested(value: Literal[DeepNested.VALUE]) -> int:
    if value == 7:
        return "reachable"  # This should generate an error.
    return 0


def test_nested_member(value: NestedAndUnknown) -> None:
    if value == 1:
        assert_type(value, Literal[NestedAndUnknown.COMPUTED, NestedAndUnknown.NESTED])


def test_custom_metaclass(value: MetaEnum) -> None:
    if value == 1:
        assert_type(value, MetaEnum)


def register_dynamic(owner: Any) -> None:
    value = int.__new__(owner, 1)
    value._name_ = "DYNAMIC"
    value._value_ = 1
    owner._member_map_["DYNAMIC"] = value
    owner._value2member_map_[1] = value
    owner._member_names_.append("DYNAMIC")


class HookBase(IntEnum):
    def __init_subclass__(cls) -> None:
        super().__init_subclass__()
        register_dynamic(cls)


class HookEnum(HookBase):
    ONE = 1
    COMPUTED = number()
    THREE = 3


class Register:
    def __get__(self, instance: object, owner: object) -> object:
        return self

    def __set_name__(self, owner: Any, name: str) -> None:
        register_dynamic(owner)


class DescriptorEnum(IntEnum):
    ONE = 1
    COMPUTED = number()
    THREE = 3
    hook = Register()


def accept_hook(value: Literal[HookEnum.ONE, HookEnum.COMPUTED]) -> None:
    pass


def accept_descriptor(value: Literal[DescriptorEnum.ONE, DescriptorEnum.COMPUTED]) -> None:
    pass


def test_subclass_hook(value: HookEnum) -> None:
    if value == 1:
        assert_type(value, HookEnum)
        accept_hook(value)  # This should generate an error.


def test_descriptor_hook(value: DescriptorEnum) -> None:
    if value == 1:
        assert_type(value, DescriptorEnum)
        accept_descriptor(value)  # This should generate an error.


T = TypeVar("T", bound=Mixed)
C = TypeVar("C", Literal[Mixed.ONE], Literal[Mixed.COMPUTED], Literal[Mixed.THREE])


def test_bound_typevar(value: T) -> T:
    if value == 1:
        return value
    raise ValueError()


def test_constrained_typevar(value: C) -> C:
    if value == 1:
        return value
    return value
