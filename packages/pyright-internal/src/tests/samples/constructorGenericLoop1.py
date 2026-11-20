# Generic constructor inference in a loop must retain the speculative pass.

from dataclasses import dataclass


@dataclass
class Box[T]:
    v: T


def step[T](b: Box[T]) -> T: ...


def run() -> None:
    val = 0
    for _ in range(3):
        val = step(Box(Box(val)))


# Finite nesting and an invalid specialization are neighboring controls.
reveal_type(step(Box(Box(0))), expected_text="Box[int]")
Box[int]("bad")  # E
