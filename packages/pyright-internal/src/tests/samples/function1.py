# This sample tests that args and kwargs parameters are
# properly typed.


def function_with_args(*args: str):
    reveal_type(args, expected_text="tuple[str, ...]")


def function_with_kwargs(**kwargs: list[str]):
    reveal_type(kwargs, expected_text="dict[str, list[str]]")
