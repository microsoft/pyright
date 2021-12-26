# This sample tests the handling of metaclass keyword arguments.

from typing import Tuple, Dict, Any, Type
from typing_extensions import Self


class Meta1(type):
    def __new__(
        cls: Type[Self],
        cls_name: str,
        bases: Tuple[type, ...],
        attrs: Dict[str, Any],
        *,
        param1: int,
        param2: str,
        param3: str = "",
    ) -> Self:
        ...


class Class1_1(metaclass=Meta1, param1=1, param2="", param3=""):
    ...


class Class1_2(metaclass=Meta1, param2="", param1=1):
    ...


# This should generate an error because param1 is the wrong type.
class Class1_3(metaclass=Meta1, param1="", param2=""):
    ...


# This should generate an error because param1 and param2 are missing.
class Class1_4(metaclass=Meta1):
    ...


# This should generate an error because param4 doesn't exist.
class Class1_5(metaclass=Meta1, param2="", param1=1, param4=3):
    ...


class Meta2(type):
    def __new__(
        cls: Type[Self],
        cls_name: str,
        bases: Tuple[type, ...],
        attrs: Dict[str, Any],
        *,
        param1: int,
        **kwargs: str,
    ) -> Self:
        ...


class Class2_1(metaclass=Meta2, param1=1, param2="", param3=""):
    ...


class Class2_2(metaclass=Meta2, param2="", param1=1, param20=""):
    ...


# This should generate an error because param1 is the wrong type.
class Class2_3(metaclass=Meta2, param1="", param2=""):
    ...


# This should generate an error because param1 is missing.
class Class2_4(metaclass=Meta2):
    ...


# This should generate an error because param4 is the wrong type.
class Class2_5(metaclass=Meta2, param2="", param1=1, param4=3):
    ...
