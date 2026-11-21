# This sample tests class namespace lookup in generic type alias values.

from typing import assert_type


class Inner:
    pass


class Outer:
    class Inner:
        pass

    type Alias[T] = bool | Inner
    type Qualified[T] = bool | Outer.Inner
    type Plain = bool | Inner
    type Pair[T] = tuple[T, Inner]
    type Forward[T] = tuple[T, Later]
    type Shadow[Inner] = list[Inner]

    class Later:
        pass

    class Nested:
        type Alias[T] = Inner

    def method(self):
        return Inner()


def check(
    alias: Outer.Alias[int],
    qualified: Outer.Qualified[int],
    plain: Outer.Plain,
    pair: Outer.Pair[int],
    forward: Outer.Forward[str],
    shadow: Outer.Shadow[int],
    nested: Outer.Nested.Alias[int],
):
    assert_type(alias, bool | Outer.Inner)
    assert_type(qualified, bool | Outer.Inner)
    assert_type(plain, bool | Outer.Inner)
    assert_type(pair, tuple[int, Outer.Inner])
    assert_type(forward, tuple[str, Outer.Later])
    assert_type(shadow, list[int])
    assert_type(nested, Inner)
    assert_type(Outer().method(), Inner)
