# This sample tests the case where a `type[T]` or `type[Self]` typevar is
# used as the base for a member access but is then used to call an
# instance method on the resulting class.

from contextlib import contextmanager


class A:
    @classmethod
    def method1(cls) -> None:
        cls.method2

    @contextmanager
    def method2(self):
        yield
