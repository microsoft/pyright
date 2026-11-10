# This sample tests narrowing for read-only nonlocal bindings.

from typing import Literal


def requires_one(value: Literal[1]) -> None:
    pass


def dead_directive():
    value = 1

    def inner():
        if False:
            nonlocal value
        reveal_type(value, expected_text="Literal[1]")
        requires_one(value)
        return value

    reveal_type(inner(), expected_text="Literal[1]")
    return inner()


reveal_type(dead_directive(), expected_text="Literal[1]")


def live_directive():
    value = 1

    def inner():
        nonlocal value
        reveal_type(value, expected_text="Literal[1]")
        requires_one(value)

    return inner


def dead_assignment():
    value = 1

    def inner():
        if False:
            nonlocal value
        requires_one(value)
        return
        value = 2

    return inner


def sibling_writer():
    value = 1

    def write():
        nonlocal value
        value = 2

    def read():
        nonlocal value
        reveal_type(value, expected_text="int")
        # This should generate an error; a sibling can change the value.
        requires_one(value)

    return write, read


def reassigned_after_capture():
    value = 1

    def read():
        nonlocal value
        reveal_type(value, expected_text="int")
        # This should generate an error; the outer assignment follows capture.
        requires_one(value)

    value = 2
    return read


def writer_before_read():
    value = 1

    def inner():
        nonlocal value
        value = 2
        reveal_type(value, expected_text="Literal[2]")
        # This should generate an error; the local flow must override capture.
        requires_one(value)

    return inner


def sibling_deleter():
    value = 1

    def delete():
        nonlocal value
        del value

    def read():
        nonlocal value
        reveal_type(value, expected_text="int")
        # This should generate an error; the cell can be deleted by a sibling.
        requires_one(value)

    return delete, read


def declared_optional(value: int | None):
    if value is not None:
        def inner():
            nonlocal value
            reveal_type(value, expected_text="int")
            return value + 1

        return inner


def same_execution_deletion():
    value = 0

    class Cleanup:
        nonlocal value
        del value

    value = 1

    def inner():
        nonlocal value
        reveal_type(value, expected_text="Literal[1]")
        requires_one(value)
        return value

    return inner


def nested_class_deleter():
    value = 1

    def delete():
        class Cleanup:
            nonlocal value
            del value

    def read():
        nonlocal value
        reveal_type(value, expected_text="int")

    return delete, read
