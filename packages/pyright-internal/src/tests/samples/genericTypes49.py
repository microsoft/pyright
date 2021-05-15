# This sample tests the handling of a bound TypeVar that is used
# in a Type[X] statement.

from typing import Callable, Generic, TypeVar, Type, Union


class Base:
    ...


T = TypeVar("T", bound=Base)


def register(state_name: str, state: Type[T]):
    ...


def register_state(state_name: str) -> Callable[[Type[T]], Type[T]]:
    def decorator(state: Type[T]) -> Type[T]:
        register(state_name, state)
        return state

    return decorator


class F:
    ...


E = TypeVar("E", bound=F)


def coercer_method(value: Union[E, str], enum: Type[E]) -> E:
    ...


class C(Generic[E]):
    e_type: Type[E]

    def coerce(self, e_type: Type[E], value: Union[E, str]) -> E:
        return coercer_method(value, self.e_type)
