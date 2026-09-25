from typing import Any, assert_type, overload


@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> list[str]: ...
def choose(value: Any) -> Any:
    return value


def invalid_expected_type(value: list[Any]):
    ret = choose(value)
    assert_type(1, ret)
