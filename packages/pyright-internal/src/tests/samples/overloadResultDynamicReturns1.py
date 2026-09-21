from typing import Any, overload


@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> Any: ...
def choose(value: Any) -> Any:
    return value


def root_dynamic_return(value: list[Any]):
    ret = choose(value)
    ret.missing_member()


@overload
def choose_nested(value: list[int]) -> list[int]: ...
@overload
def choose_nested(value: list[str]) -> list[Any]: ...
def choose_nested(value: Any) -> Any:
    return value


def nested_dynamic_return(value: list[Any]):
    ret = choose_nested(value)
    ret.pop().missing_member()
