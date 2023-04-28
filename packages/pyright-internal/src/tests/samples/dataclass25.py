# This sample tests the use of field's coverter parameter
# described in PEP 712.

from dataclasses import dataclass, field
from typing import overload


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

def converter_with_more_specialized_return_type(s: str) -> int:
    return int(s)

@dataclass
class Foo:
    field0: int = field(converter=converter_simple)
    field1: int = field(converter=converter_with_param_before_args)
    field2: int = field(converter=converter_with_args)
    field3: int = field(converter=converter_with_extra_defaulted_params)
    field4: int = field(converter=converter_with_default_for_first_param)
    field5: int | str = field(converter=converter_with_more_specialized_return_type)


reveal_type(Foo.__init__, expected_text="(self: Foo, field0: str, field1: str, field2: str, field3: str, field4: str, field5: str) -> None")


# This overload will be ignored because it has too many arguments.
@overload
def overloaded_converter(s: float, secondParam: str, /) -> int: ...

# This overload will be ignored because its return type doesn't match the field type.
@overload
def overloaded_converter(s: float) -> str: ...

@overload
def overloaded_converter(s: str) -> int: ...

@overload
def overloaded_converter(s: list[str]) -> int: ...

def overloaded_converter(s: float | str | list[str], *args: str) -> int | float | str:
    return 0


@dataclass
class Overloads:
    field0: int = field(converter=overloaded_converter)


reveal_type(Overloads.__init__, expected_text="(self: Overloads, field0: str | list[str]) -> None")


def wrong_return_type(s: str) -> str:
    return s

def wrong_number_of_params(x: str, x2: str, /) -> int:
    return 1

@overload
def wrong_converter_overload(s: float) -> str: ...

@overload
def wrong_converter_overload(s: str) -> str: ...

def wrong_converter_overload(s: float | str) -> int | str:
    return 1

@dataclass
class Errors:
    field0: int = field(converter=wrong_return_type)
    field1: int = field(converter=wrong_number_of_params)
    field2: int = field(converter=wrong_converter_overload)