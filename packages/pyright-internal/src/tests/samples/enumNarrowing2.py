# This sample tests string-literal narrowing for membership in StrEnum members.

from enum import EnumType, StrEnum
from typing import Literal, LiteralString, TypeVar, assert_type


class MediaType(StrEnum):
    APP = 'app'
    CHANNEL = 'channel'


class OtherMediaType(StrEnum):
    APP = 'app'


class EqualString(str):
    pass


class CustomEquality(StrEnum):
    VALUE = 'value'

    def __eq__(self, other: object) -> bool:
        return True

    __hash__ = str.__hash__


class CustomConstructor(StrEnum):
    def __new__(cls, value: str):
        return str.__new__(cls, value.upper())

    VALUE = 'value'


class CustomConstructorBase(StrEnum):
    def __new__(cls, value: str):
        return str.__new__(cls, value.upper())


class InheritedConstructor(CustomConstructorBase):
    VALUE = 'value'


class CustomMeta(EnumType):
    pass


class CustomMetaclass(StrEnum, metaclass=CustomMeta):
    VALUE = 'value'


def handle(value: Literal['app', 'channel']) -> None:
    pass


def plain_string(value: str) -> None:
    if value in (MediaType.APP, MediaType.CHANNEL):
        # A plain str can also be a StrEnum member or another str subclass.
        assert_type(value, str)
        handle(value)  # This should generate an error
        value.upper()
        value.name  # This should generate an error
        value.value  # This should generate an error
        if isinstance(value, MediaType):
            assert_type(value, MediaType)
            value.name


def literal_string(value: LiteralString) -> None:
    if value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, LiteralString)
        value.name  # This should generate an error

    if type(value) is str and value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, Literal['app', 'channel'])
        handle(value)


def optional_string(value: str | None) -> None:
    if value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, str | None)


def mixed_input(value: str | MediaType | None) -> None:
    if value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, str | Literal[MediaType.APP, MediaType.CHANNEL] | None)


def exact_string_first(value: str) -> None:
    if type(value) is str and value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, Literal['app', 'channel'])
        handle(value)


def exact_string_second(value: str) -> None:
    if value in (MediaType.APP, MediaType.CHANNEL) and type(value) is str:
        assert_type(value, str)


def exact_string_literal(value: Literal['app']) -> None:
    if type(value) is str:
        assert_type(value, Literal['app'])
    if type(value) is str and value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, Literal['app'])


_StrT = TypeVar('_StrT', bound=str)


def exact_string_typevar(value: _StrT) -> _StrT:
    if type(value) is str:
        return value
    return value


def enum_input(value: MediaType) -> None:
    if value in (MediaType.APP, MediaType.CHANNEL):
        assert_type(value, Literal[MediaType.APP, MediaType.CHANNEL])
        value.name


def enum_is_not_string_literal() -> None:
    handle(MediaType.APP)  # This should generate an error


def custom_equality(value: str) -> None:
    if value in (CustomEquality.VALUE,):
        assert_type(value, str)


def custom_constructor(value: str) -> None:
    if value in (CustomConstructor.VALUE,):
        assert_type(value, str)
    if value in (InheritedConstructor.VALUE,):
        assert_type(value, str)


def custom_metaclass(value: str) -> None:
    if value in (CustomMetaclass.VALUE,):
        assert_type(value, str)


# Both values are valid str arguments and can enter the positive membership branch at runtime.
plain_string(OtherMediaType.APP)
plain_string(EqualString('app'))
