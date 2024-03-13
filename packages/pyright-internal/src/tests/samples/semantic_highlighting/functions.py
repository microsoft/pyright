from typing import Callable


def foo(a: int, *b, **c) -> str:
    ...

foo()

Bar = Callable[[], None]

bar: Callable[[int], None] = None
