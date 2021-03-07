# This sample tests the handling of a bound TypeVar that is used
# in a Type[X] statement.

from typing import Callable, TypeVar, Type

class Base:
    ...

T = TypeVar('T', bound=Base)

def register(state_name: str, state: Type[T]): ...

def register_state(state_name: str) -> Callable[[Type[T]], Type[T]]:
    def decorator(state: Type[T]) -> Type[T]:
        register(state_name, state)
        return state

    return decorator


