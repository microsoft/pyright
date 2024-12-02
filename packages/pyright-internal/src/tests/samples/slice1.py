# This sample tests the evaluation of slice types.

class ClassA:
    def __getitem__[T](self, item: T) -> T:
        return item
a1 = ClassA()

reveal_type(a1[::], expected_text="slice[None, None, None]")
reveal_type(a1[1:'a':False], expected_text="slice[Literal[1], Literal['a'], Literal[False]]")
reveal_type(a1[:3:5.0], expected_text="slice[None, Literal[3], float]")
