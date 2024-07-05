# This sample tests the case where a callback protocol uses a
# class-level type variable and a combination of Type[T] and T.

from typing import Protocol, TypeVar, Type

TE = TypeVar("TE", bound=Exception)


class CallbackProtocol1(Protocol[TE]):
    def __call__(self, s_exc: Exception, t_exc_class: Type[TE]) -> TE: ...


def func1(s_exc: Exception, t_exc_class: Type[TE]) -> TE: ...


def func2(
    s_exc_class: Exception,
    t_exc_class: Type[TE],
    mapper: CallbackProtocol1[TE] = func1,
): ...
