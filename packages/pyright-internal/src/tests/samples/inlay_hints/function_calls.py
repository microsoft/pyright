def foo(value: int, bar: str | None = None) -> None: ...

foo(1)  # inlay hint
foo()  # no inlay hint
foo(value=1)  # no inlay hint
foo(1, "")  # 2 inlay hints