from typing import Callable

def foo(): ...  # inlay hint
def baz(fn: Callable[[], int]):  # inlay hint
    return ""
def bar() -> int: ...  # no inlay hint