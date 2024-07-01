# This sample tests the reporting of inconsistent use of @classmethod
# and @staticmethod in overloads.

from typing import Any, overload


class A:
    @overload
    # This should emit an error because @staticmethod is used inconsistently.
    def method1(self, x: int) -> int: ...

    @overload
    @staticmethod
    def method1(x: str) -> str: ...

    def method1(*args: Any, **kwargs: Any) -> Any:
        return

    @overload
    @classmethod
    # This should emit an error because @classmethod is used inconsistently.
    def method2(cls, x: str) -> str: ...

    @overload
    def method2(self, x: int) -> int: ...

    def method2(*args: Any, **kwargs: Any) -> Any:
        return

    @overload
    # This should emit an error because @staticmethod is used inconsistently.
    def method3(self, x: str) -> str: ...

    @overload
    def method3(self, x: int) -> int: ...

    @staticmethod
    def method3(*args: Any, **kwargs: Any) -> Any:
        return
