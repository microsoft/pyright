# This sample tests classmethod and staticmethod applied to callable protocols
# returned by another decorator, including protocols that are descriptors.

from typing import Callable, Generic, ParamSpec, Protocol, TypeVar, overload

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


class Wrapper(Protocol[P, R]):
    value: R

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R: ...

    def retry_with(self) -> "Wrapper[P, R]": ...

    @overload
    def __get__(self, instance: None, owner: type | None = None) -> "Wrapper[P, R]": ...

    @overload
    def __get__(self, instance: object, owner: type | None = None) -> "Wrapper[..., R]": ...


def decorate(func: Callable[P, R]) -> Wrapper[P, R]: ...


class Example:
    @classmethod
    @decorate
    def method(cls, value: int, *, label: str = "") -> int:
        return value

    @classmethod
    @decorate
    async def async_method(cls, value: int) -> int:
        return value

    @staticmethod
    @decorate
    def static_method(value: int) -> int:
        return value

    @staticmethod
    @decorate
    async def async_static_method(value: int) -> int:
        return value


instance = Example()
reveal_type(Example.method(1), expected_text="int")
reveal_type(instance.method(value=1, label="label"), expected_text="int")
reveal_type(Example.static_method(1), expected_text="int")
reveal_type(instance.static_method(value=1), expected_text="int")
reveal_type(Example.method.value, expected_text="int")
reveal_type(instance.method.value, expected_text="int")
reveal_type(Example.static_method.value, expected_text="int")
reveal_type(instance.static_method.value, expected_text="int")
reveal_type(Example.method.retry_with().value, expected_text="int")
reveal_type(instance.method.retry_with().value, expected_text="int")
reveal_type(Example.static_method.retry_with().value, expected_text="int")
reveal_type(instance.static_method.retry_with().value, expected_text="int")

# This should generate an error because value must be an int.
Example.method("invalid")

# This should generate an error because value is required.
instance.method()

# This should generate an error because staticmethod must not bind value.
instance.static_method()

# This should generate an error because value must be an int.
instance.static_method("invalid")


async def check_async() -> None:
    reveal_type(await Example.async_method(1), expected_text="int")
    reveal_type(await instance.async_method(value=1), expected_text="int")
    reveal_type(await Example.async_static_method(1), expected_text="int")
    reveal_type(await instance.async_static_method(value=1), expected_text="int")


class CallableWrapper(Protocol[P, R]):
    value: R

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R: ...


def decorate_callable(func: Callable[P, R]) -> CallableWrapper[P, R]: ...


class OtherExample:
    @classmethod
    @decorate_callable
    def method(cls, value: str) -> str:
        return value


reveal_type(OtherExample.method("value"), expected_text="str")
reveal_type(OtherExample().method("value"), expected_text="str")


class OverloadedWrapper(Protocol):
    @overload
    def __call__(self, value: int) -> int: ...

    @overload
    def __call__(self, value: str) -> str: ...


def decorate_overloaded(func: Callable[..., object]) -> OverloadedWrapper: ...


class OverloadedExample:
    @staticmethod
    @decorate_overloaded
    def method(value: int | str) -> int | str:
        return value


reveal_type(OverloadedExample.method(1), expected_text="int")
reveal_type(OverloadedExample.method("text"), expected_text="str")
reveal_type(OverloadedExample().method(1), expected_text="int")
reveal_type(OverloadedExample().method("text"), expected_text="str")

# This should generate two errors because neither overload accepts a float.
OverloadedExample.method(1.5)


class GenericExample(Generic[T]):
    @staticmethod
    @decorate_callable
    def method(value: T) -> T:
        return value

    @classmethod
    @decorate_callable
    def class_method(cls, value: T) -> T:
        return value


reveal_type(GenericExample[int].method(1), expected_text="int")
reveal_type(GenericExample[str].method("text"), expected_text="str")
reveal_type(GenericExample[int].method.value, expected_text="int")
reveal_type(GenericExample[str].method.value, expected_text="str")
reveal_type(GenericExample[int]().method.value, expected_text="int")
reveal_type(GenericExample[str]().method.value, expected_text="str")
reveal_type(GenericExample[int].class_method(1), expected_text="int")
reveal_type(GenericExample[int].class_method.value, expected_text="int")
reveal_type(GenericExample[int]().class_method.value, expected_text="int")

# This should generate an error because the class specializes T to int.
GenericExample[int].method("invalid")


class InheritedExample(GenericExample[int]):
    pass


reveal_type(InheritedExample.method(1), expected_text="int")
reveal_type(InheritedExample.method.value, expected_text="int")
reveal_type(InheritedExample().class_method.value, expected_text="int")


class BoundOverloadedWrapper(Protocol):
    @overload
    def __call__(self, value: int) -> int: ...

    @overload
    def __call__(self, value: str) -> str: ...


class DescriptorOverloadedWrapper(Protocol):
    value: str

    @overload
    def __call__(self, owner: type[object], value: int) -> int: ...

    @overload
    def __call__(self, owner: type[object], value: str) -> str: ...

    def __get__(self, instance: object, owner: type[object] | None = None) -> BoundOverloadedWrapper: ...


def decorate_descriptor_overloaded(func: Callable[..., object]) -> DescriptorOverloadedWrapper: ...


class DescriptorOverloadedExample:
    @classmethod
    @decorate_descriptor_overloaded
    def method(cls, value: int | str) -> int | str:
        return value


reveal_type(DescriptorOverloadedExample.method(1), expected_text="int")
reveal_type(DescriptorOverloadedExample.method("text"), expected_text="str")
reveal_type(DescriptorOverloadedExample().method(1), expected_text="int")
reveal_type(DescriptorOverloadedExample().method("text"), expected_text="str")
reveal_type(DescriptorOverloadedExample.method.value, expected_text="str")

# This should generate two errors because neither overload accepts a float.
DescriptorOverloadedExample.method(1.5)


class BoundGenericWrapper(Protocol):
    def __call__(self, func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R: ...


class DescriptorGenericWrapper(Protocol):
    def __call__(self, owner: type[object], func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R: ...

    def __get__(self, instance: object, owner: type[object] | None = None) -> BoundGenericWrapper: ...


def decorate_descriptor_generic(func: Callable[..., object]) -> DescriptorGenericWrapper: ...


class DescriptorGenericExample:
    @classmethod
    @decorate_descriptor_generic
    def method(cls, func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)


def format_value(value: int, *, label: str) -> str:
    return label + str(value)


reveal_type(DescriptorGenericExample.method(format_value, 1, label="n="), expected_text="str")
reveal_type(DescriptorGenericExample().method(format_value, 1, label="n="), expected_text="str")

# This should generate an error because label is required.
DescriptorGenericExample.method(format_value, 1)

# This should generate an error because value must be an int.
DescriptorGenericExample.method(format_value, "invalid", label="n=")

# This should generate an error because label must be a str.
DescriptorGenericExample.method(format_value, 1, label=1)
