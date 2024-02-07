from typing import Any, Callable


def foo(bar: Any) -> Any:
    print(bar)
    return bar

bar: Any = object()

@bar
class Bar(bar): ...

@bar
def baz() -> None: ...

qux: Callable[[], Any] = lambda: bar

match(bar):
    case _:
        ...