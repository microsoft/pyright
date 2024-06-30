# This sample tests that a class is not assignable to Self@Class.

from typing import Self


class A:
    def self_arg(self, other: Self): ...

    def call_self_arg(self):
        # This should generate an error.
        self.self_arg(A())

    def get_instance(self) -> Self:
        # This should generate an error.
        return A()
