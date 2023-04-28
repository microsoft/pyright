# This sample tests the use of field's coverter parameter
# described in PEP 712.

from dataclasses import dataclass, field
from typing import overload


# class Errors:
#     not_a_function: int = field(converter=1)


def converter_simple(s: str) -> int:
    return int(s)

def converter_with_param_before_args(s: str, *args: int, **kwargs: int) -> int:
    return int(s)

def converter_with_args(*args: str) -> int:
    return int(args[0])

def converter_with_extra_defaulted_params(s: str, extra: int = 1, *, extraKwarg: int = 1) -> int:
    return int(s)

def converter_with_default_for_first_param(s: str = "1") -> int:
    return int(s)


@dataclass
class Foo:
    field0: int = field(converter=converter_simple)                       # type: ignore
    field1: int = field(converter=converter_with_param_before_args)       # type: ignore
    field2: int = field(converter=converter_with_args)                    # type: ignore
    field3: int = field(converter=converter_with_extra_defaulted_params)  # type: ignore
    field4: int = field(converter=converter_with_default_for_first_param) # type: ignore


reveal_type(Foo.__init__, expected_text="(self: Foo, field0: str, field1: str, field2: str, field3: str, field4: str) -> None")


# @overload
# def overloaded_converter(s: float, secondParam: str = "foo") -> int: ...

# This overload will be ignored because it doesn't match the field type.
@overload
def overloaded_converter(s: float) -> str: ...

@overload
def overloaded_converter(s: str) -> int: ...

@overload
def overloaded_converter(s: list[str]) -> int: ...

def overloaded_converter(s: float | str | list[str]) -> int | float | str:
    return 0


@dataclass
class Overloads:
    field0: int = field(converter=overloaded_converter) # type: ignore


reveal_type(Overloads.__init__, expected_text="(self: Overloads, field0: str | list[str]) -> None")

