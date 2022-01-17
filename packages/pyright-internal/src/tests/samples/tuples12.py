# This sample tests type inference for tuples that contain unpack
# operators.


def func1(a: int, *args: int):
    v1 = (a, *args)
    reveal_type(v1, expected_text="tuple[int, *tuple[int, ...]]")


def func2(a: int, *args: str):
    v1 = (a, *args)
    reveal_type(v1, expected_text="tuple[int, *tuple[str, ...]]")


def func3(a: int, b: str, *args: str):
    v1 = (a, b, *(a, b, a), *args, a, *args, b, *(a, b, a))
    reveal_type(
        v1, expected_text="tuple[int, str, int, str, int, *tuple[str | int, ...]]"
    )


def func4(a: int, b: str, *args: str):
    v1 = (b, *args, *(b, a))
    reveal_type(v1, expected_text="tuple[str, *tuple[str, ...], str, int]")


def func5():
    a = 3.4
    b = [1, 2, 3]
    v1 = (a, *b)
    reveal_type(v1, expected_text="tuple[float, *tuple[int, ...]]")
