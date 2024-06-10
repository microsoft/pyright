# This sample tests the case where bidirectional type inference is used
# in a nested manner with list comprehensions.

# pyright: strict

from itertools import chain

times = [
    (hour, minute, meridian)
    for hour, minute, meridian in chain.from_iterable(
        chain.from_iterable(
            ((hour, minute, meridian) for minute in range(0, 60, 15))
            for hour in range(12)
        )
        for meridian in ("am", "pm")
    )
]
reveal_type(times, expected_text="list[tuple[int, int, str]]")
