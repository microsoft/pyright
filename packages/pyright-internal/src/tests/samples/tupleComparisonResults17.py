# Distinct deep alias specializations must retain their ordering obligations.
from typing import assert_type


class TextOrder:
    def __lt__(self, other: object) -> str:
        return "text"

    def __le__(self, other: object) -> str:
        return "text"

    def __gt__(self, other: object) -> str:
        return "text"

    def __ge__(self, other: object) -> str:
        return "text"


type Envelope[T] = tuple[T]
type I1 = tuple[int]
type S1 = tuple[TextOrder]
type I2 = tuple[I1]
type S2 = tuple[S1]
type I3 = tuple[I2]
type S3 = tuple[S2]
type I4 = tuple[I3]
type S4 = tuple[S3]
type I5 = tuple[I4]
type S5 = tuple[S4]
type I6 = tuple[I5]
type S6 = tuple[S5]
type I7 = tuple[I6]
type S7 = tuple[S6]
type I8 = tuple[I7]
type S8 = tuple[S7]
type I9 = tuple[I8]
type S9 = tuple[S8]
type I10 = tuple[I9]
type S10 = tuple[S9]
type I11 = tuple[I10]
type S11 = tuple[S10]
type I12 = tuple[I11]
type S12 = tuple[S11]
type I13 = tuple[I12]
type S13 = tuple[S12]
type I14 = tuple[I13]
type S14 = tuple[S13]
type I15 = tuple[I14]
type S15 = tuple[S14]
type I16 = tuple[I15]
type S16 = tuple[S15]
type I17 = tuple[I16]
type S17 = tuple[S16]
type I18 = tuple[I17]
type S18 = tuple[S17]
type I19 = tuple[I18]
type S19 = tuple[S18]
type I20 = tuple[I19]
type S20 = tuple[S19]
type I21 = tuple[I20]
type S21 = tuple[S20]
type I22 = tuple[I21]
type S22 = tuple[S21]
type I23 = tuple[I22]
type S23 = tuple[S22]
type I24 = tuple[I23]
type S24 = tuple[S23]


def needs_bool(value: bool) -> None:
    pass


def shallow(
    left: tuple[Envelope[I1], Envelope[S1]],
    right: tuple[Envelope[I1], Envelope[S1]],
) -> None:
    assert_type(left < right, str | bool)
    assert_type(left <= right, str | bool)
    assert_type(left > right, str | bool)
    assert_type(left >= right, str | bool)
    needs_bool(left < right)  # This should generate an argument-type error.
    needs_bool(left <= right)  # This should generate an argument-type error.
    needs_bool(left > right)  # This should generate an argument-type error.
    needs_bool(left >= right)  # This should generate an argument-type error.


def deep(
    left: tuple[Envelope[I24], Envelope[S24]],
    right: tuple[Envelope[I24], Envelope[S24]],
) -> None:
    assert_type(left < right, str | bool)
    assert_type(left <= right, str | bool)
    assert_type(left > right, str | bool)
    assert_type(left >= right, str | bool)
    needs_bool(left < right)  # This should generate an argument-type error.
    needs_bool(left <= right)  # This should generate an argument-type error.
    needs_bool(left > right)  # This should generate an argument-type error.
    needs_bool(left >= right)  # This should generate an argument-type error.
