# This sample tests the case where the tuple constructor is called
# explicitly with bidirectional type inference.

v1: tuple[float] = tuple([1.0, 2.0])
reveal_type(v1, expected_text="tuple[float, ...]")

v2: tuple[float] | tuple[float, float] = tuple([1.0, 2.0])
reveal_type(v2, expected_text="tuple[float, ...]")
