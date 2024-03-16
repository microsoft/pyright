from typing import overload

def foo(value: int, bar: str | None = None) -> None: ...

val = 1
foo(val)  # inlay hint
foo()  # no inlay hint
foo(value=1)  # no inlay hint
foo(1, "")  # 2 inlay hints

value=3
foo(value, "")  # only 1 inlay hint for bar since value has the same name

@overload
def bar(a: int) -> int: ...
@overload
def bar(b: str) -> str: ...
def bar(*args: object, **kwargs: object) -> None: ...

bar(1)  # inlay hint of "a"
bar("")  # inlay hint of "b"
bar([])  # no inlay hint because no matching overload

def baz(*args: object) -> None: ...
baz(1)  # no inlay hint because the arg doesn't have a name