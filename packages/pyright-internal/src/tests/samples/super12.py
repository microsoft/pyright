# This sample tests the case where a class derives from a protocol
# and calls through super() to the protocol class to a method that is
# not implemented.

from typing import Protocol


class BaseProto(Protocol):
    def method1(self) -> None: ...


class ProtoImpl(BaseProto):
    def method1(self) -> None:
        # This should generate an error.
        return super().method1()
