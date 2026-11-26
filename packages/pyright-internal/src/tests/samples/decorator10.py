# This sample tests nested classmethod descriptors on callable wrappers.

from __future__ import annotations

import sys
from typing import Callable, Generic, TypeVar, overload
from typing_extensions import ParamSpec, assert_type

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


class Wrapper(Generic[P, R]):
    value: R

    def __init__(self, function: Callable[P, R]) -> None:
        self.function = function

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        return self.function(*args, **kwargs)


class Example:
    # This should generate an error before Python 3.9 and from Python 3.13
    # because classmethod does not delegate to the inner descriptor.
    @classmethod
    @classmethod
    @Wrapper
    def method(cls, value: int) -> str:
        return str(value)


class Child(Example):
    pass


if sys.version_info >= (3, 9) and sys.version_info < (3, 13):
    assert_type(Example.method(1), str)
    assert_type(Example().method(value=1), str)
    assert_type(Child.method(1), str)
    assert_type(Child().method(value=1), str)
    assert_type(Example.method.value, str)
    assert_type(Child().method.value, str)

    # This should generate an error because value must be an int.
    Example.method("invalid")

    # This should generate an error because value is required.
    Child().method()

    class GenericExample(Generic[T]):
        @classmethod
        @classmethod
        @classmethod
        @Wrapper
        def method(cls, value: T) -> T:
            return value

    assert_type(GenericExample[int].method(1), int)
    assert_type(GenericExample[str]().method("text"), str)
    assert_type(GenericExample[int].method.value, int)
    assert_type(GenericExample[str]().method.value, str)

    # This should generate an error because T is specialized to int.
    GenericExample[int].method("invalid")

    class MetaMeta(type):
        pass

    class Meta(type, metaclass=MetaMeta):
        pass

    class Descriptor:
        def __init__(self, function: Callable[..., int]) -> None:
            self.function = function

        def __call__(self, owner: type, value: int) -> int:
            return self.function(owner, value)

        @overload
        def __get__(self, instance: type[Meta], owner: None) -> Callable[[str], str]: ...
        @overload
        def __get__(self, instance: type[MetaMeta], owner: None) -> Callable[[bytes], bytes]: ...
        @overload
        def __get__(self, instance: object, owner: type) -> Callable[[str], str]: ...
        def __get__(
            self, instance: object, owner: type | None
        ) -> Callable[[str], str] | Callable[[bytes], bytes]:
            return bytes.upper if instance is MetaMeta else str.upper

    class DescriptorExample(metaclass=Meta):
        @classmethod
        @classmethod
        @Descriptor
        def method(cls, value: int) -> int:
            return value

        @classmethod
        @classmethod
        @classmethod
        @Descriptor
        def triple(cls, value: int) -> int:
            return value

    class DescriptorChild(DescriptorExample):
        pass

    assert_type(DescriptorExample.method("text"), str)
    assert_type(DescriptorChild().method("text"), str)
    if sys.version_info < (3, 10):
        assert_type(DescriptorChild.triple(b"text"), bytes)
    else:
        assert_type(DescriptorChild.triple("text"), str)

    # This should generate an error because the descriptor returns str.upper.
    DescriptorExample.method(1)
