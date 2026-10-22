# This sample tests evaluation boundaries for TypedDict presence proofs.

from typing import Generator, Literal, TypedDict, assert_type


class Data(TypedDict, total=False):
    a: int
    b: str


Key = Literal["a", "b"]


class Holder:
    data: Data
    key: Key


def replaced_holder(holder: Holder, other: Holder):
    if holder.key in (holder := other).data:
        # This should generate an error: the old holder's key was checked.
        value = holder.data[holder.key]
        assert_type(value, int | str)


def replaced_key(data: Data, key: Key, replacement: Key):
    if key in (data := ((key := replacement), data)[1]):
        # This should generate an error: the old key was checked.
        value = data[key]
        assert_type(value, int | str)


def replaced_before_guard(holder: Holder, other: Holder):
    if (holder := other).key in holder.data:
        assert_type(holder.data[holder.key], int | str)


def unchanged_guard(data: Data, key: Key):
    if key in (data := data):
        assert_type(data[key], int | str)


def deferred_guard(data: Data, key: Key):
    if key in data:
        # This should generate an error: the read runs when the generator is advanced.
        values = (data[key] for _ in (0,))
        assert_type(values, Generator[int | str, None, None])


def fresh_generator_guard(data: Data, key: Key):
    values = (data[key] for _ in (0,) if key in data)
    assert_type(values, Generator[int | str, None, None])


def eager_comprehensions(data: Data, key: Key):
    if key in data:
        values = [data[key] for _ in (0,)]
        assert_type(values, list[int | str])
    values2 = [data[key] for _ in (0,) if key in data]
    assert_type(values2, list[int | str])


def first_iterable(data: Data, key: Key):
    if key in data:
        values = (value for value in (data[key],))
        assert_type(values, Generator[int | str, None, None])


def deferred_iterable(data: Data, key: Key):
    if key in data:
        # This should generate an error: only the first iterable is eager.
        values = (value for _ in (0,) for value in (data[key],))
        assert_type(values, Generator[int | str, None, None])


def nested_eager_comprehension(data: Data, key: Key):
    if key in data:
        # This should generate an error: the list is built in the generator body.
        values = ([data[key] for _ in (0,)] for _ in (0,))
        assert_type(values, Generator[list[int | str], None, None])


def guarded_nested_comprehension(data: Data, key: Key):
    values = ([data[key] for _ in (0,)] for _ in (0,) if key in data)
    assert_type(values, Generator[list[int | str], None, None])


def nested_generator(data: Data, key: Key):
    # This should generate an error: the inner generator can outlive the outer guard.
    values = ((data[key] for _ in (0,)) for _ in (0,) if key in data)
    assert_type(values, Generator[Generator[int | str, None, None], None, None])
