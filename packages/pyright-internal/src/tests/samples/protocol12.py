# This sample verifies that an error is generated when a non-protocol
# class is used as a base class for a protocol class.

from typing import Protocol


class BaseClass:
    x: int


class DerivedClass(BaseClass, Protocol):
    x: int
