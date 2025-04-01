# This sample tests the case where a lambda's type is determined using
# bidirectional type inference and one or more of the parameters
# corresponds to a generic type.

from typing import Callable, TypeVar, Generic, Any

T = TypeVar("T")
MsgT = TypeVar("MsgT", bound="Msg[Any]")


class Msg(Generic[T]):
    body: T


class Request: ...


def check(func: "Callable[[MsgT, int], object]") -> MsgT: ...


notification: Msg[Request] = check(lambda msg, foo: (msg.body, foo))
