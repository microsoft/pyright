def foo(value: int, bar: str | None = None) -> None: ...

val = 1
foo(val)  # inlay hint
foo()  # no inlay hint
foo(value=1)  # no inlay hint
foo(1, "")  # 2 inlay hints

value=3
foo(value, "")  # only 1 inlay hint for bar since value has the same name