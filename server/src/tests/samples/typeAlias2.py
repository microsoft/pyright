# This sample tests that forward references to type aliases work.

from typing import Dict, Any, Union

class Base:
    @staticmethod
    def create(data: Dict[str, Any]) -> 'Mix':
        return A()

class A(Base):
    pass

class B(Base):
    pass

Mix = Union[A, B]

class S:
    @staticmethod
    def create(data: Dict[str, Any]) -> 'Mix':
        return A()

