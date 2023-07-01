# This sample tests that forward references to type aliases work.

from typing import Any, Union


class Base:
    @staticmethod
    def create(data: dict[str, Any]) -> "Mix":
        return A()


class A(Base):
    pass


class B(Base):
    pass


Mix = Union[A, B]


class S:
    @staticmethod
    def create(data: dict[str, Any]) -> "Mix":
        return A()
