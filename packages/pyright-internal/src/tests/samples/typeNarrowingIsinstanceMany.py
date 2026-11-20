from typing import Generic, TypeVar, assert_type, final

T = TypeVar("T")


class Box(Generic[T]):
    def get(self) -> T:
        raise NotImplementedError


@final
class Other:
    pass


def check(value: Box[T] | Other, default: T) -> T:
    if isinstance(value, ((str, int), (Box, bytes))):
        assert_type(value, Box[T])
        return value.get()

    assert_type(value, Other)
    return default


def invalid(value: Box[int] | Other) -> None:
    if not isinstance(value, (Box, str)):
        # This should generate an error.
        value.get()
