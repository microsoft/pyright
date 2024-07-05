# This sample tests the handling of a bound TypeVar that is used
# in a Type[X] statement.

from typing import Callable, Generic, TypeVar


class Base: ...


T = TypeVar("T", bound=Base)


def register(state_name: str, state: type[T]): ...


def register_state(state_name: str) -> Callable[[type[T]], type[T]]:
    def decorator(state: type[T]) -> type[T]:
        register(state_name, state)
        return state

    return decorator


class F: ...


E = TypeVar("E", bound=F)


def coercer_method(value: E | str, enum: type[E]) -> E: ...


class C(Generic[E]):
    e_type: type[E]

    def coerce(self, e_type: type[E], value: E | str) -> E:
        return coercer_method(value, self.e_type)
