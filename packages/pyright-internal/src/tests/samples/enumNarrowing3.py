# This sample tests exact-string flow facts used for StrEnum membership narrowing.

from enum import StrEnum
from typing import Literal, LiteralString, TypeVar, assert_type


class Media(StrEnum):
    APP = 'app'


class Other(StrEnum):
    APP = 'app'


def handle(value: Literal['app']) -> None:
    pass


def dynamic_class(value: str, kind: type[str]) -> None:
    if type(value) is kind and value in (Media.APP,):
        assert_type(value, str)
        handle(value)  # This should generate an error
    if kind is type(value) and value in (Media.APP,):
        assert_type(value, str)
        handle(value)  # This should generate an error


def merged(value: str, flag: bool) -> None:
    if flag and type(value) is str:
        pass
    if value in (Media.APP,):
        assert_type(value, str)
        handle(value)  # This should generate an error

    if type(value) is str:
        pass
    else:
        pass
    if value in (Media.APP,):
        assert_type(value, str)
        handle(value)  # This should generate an error


def exact_on_all_paths(value: str, flag: bool) -> None:
    if flag:
        if type(value) is not str:
            return
    elif type(value) is not str:
        return
    if value in (Media.APP,):
        assert_type(value, Literal['app'])
        handle(value)


def reassigned(value: str, other: str) -> None:
    if type(value) is str:
        value = other
        if value in (Media.APP,):
            assert_type(value, str)
            handle(value)  # This should generate an error


def loop(value: str, other: str, flag: bool) -> None:
    if type(value) is str:
        while flag:
            value = other
            flag = False
        if value in (Media.APP,):
            assert_type(value, str)
            handle(value)  # This should generate an error


T = TypeVar('T')


def choose(left: T, right: T, flag: bool) -> T:
    return left if flag else right


def generic(value: str, other: str, flag: bool) -> None:
    if type(value) is str:
        result = choose(value, other, flag)
        if result in (Media.APP,):
            assert_type(result, str)
            handle(result)  # This should generate an error


def container(value: str, other: str) -> None:
    if type(value) is str:
        items = [value]
        items.append(other)
        if items[1] in (Media.APP,):
            assert_type(items[1], str)
            handle(items[1])  # This should generate an error


class ChangingValue:
    def __init__(self) -> None:
        self.first = True

    @property
    def value(self) -> str:
        if self.first:
            self.first = False
            return 'app'
        return Other.APP


def property_value(obj: ChangingValue) -> None:
    if type(obj.value) is str and obj.value in (Media.APP,):
        assert_type(obj.value, str)
        handle(obj.value)  # This should generate an error


def exact_object(value: object) -> None:
    if type(value) is str and value in (Media.APP,):
        assert_type(value, Literal['app'])
        handle(value)


def exact_class_alias(value: str) -> None:
    cls = str
    if type(value) is cls and value in (Media.APP,):
        assert_type(value, Literal['app'])
        handle(value)


def equality_guard(value: str) -> None:
    if type(value) == str and value in (Media.APP,):
        assert_type(value, str)
        handle(value)  # This should generate an error


def loop_back(value: str, other: str, flag: bool) -> None:
    if type(value) is str:
        while flag:
            if value in (Media.APP,):
                assert_type(value, str)
                handle(value)  # This should generate an error
            value = other


def merged_literal_string(value: LiteralString, flag: bool) -> None:
    if flag and type(value) is str:
        pass
    if value in (Media.APP,):
        assert_type(value, LiteralString)
        handle(value)  # This should generate an error


def merged_optional(value: str | None, flag: bool) -> None:
    if flag and type(value) is str:
        pass
    if value in (Media.APP,):
        assert_type(value, str | None)
        handle(value)  # This should generate an error


StrT = TypeVar('StrT', bound=str)


def dynamic_typevar(value: str, kind: type[StrT]) -> None:
    if type(value) is kind and value in (Media.APP,):
        handle(value)  # This should generate an error


dynamic_class(Other.APP, Other)
merged(Other.APP, False)
