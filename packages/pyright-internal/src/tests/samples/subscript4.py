# This sample tests the handling of unpack operators within
# a subscript.

from typing import NamedTuple


class Recorder[T]:
    def __getitem__(self, item: T) -> T:
        return item


class OneInt(NamedTuple):
    value: int


class IntStrPair(NamedTuple):
    first: int
    second: str


recorder_pair: Recorder[tuple[int, str]] = Recorder()
pair = IntStrPair(1, "value")
result1 = recorder_pair[*pair]
reveal_type(result1, expected_text="tuple[int, str]")

recorder_order: Recorder[tuple[int, str]] = Recorder()
tail_value: str = "tail"
result2 = recorder_order[*OneInt(2), tail_value]
reveal_type(result2, expected_text="tuple[int, str]")

recorder_multi: Recorder[tuple[int, *tuple[int | str, ...]]] = Recorder()
values1: list[int] = []
values2: list[str] = []
first_value: int = 0
result3 = recorder_multi[first_value, *values1, *values2]
reveal_type(result3, expected_text="tuple[int, *tuple[int | str, ...]]")
