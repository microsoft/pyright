from __future__ import annotations

from typing_extensions import assert_type

from sqlalchemy.orm.strategy_options import (
    Load,
    contains_eager,
    defaultload,
    defer,
    immediateload,
    joinedload,
    lazyload,
    load_only,
    loader_option,
    noload,
    raiseload,
    selectin_polymorphic,
    selectinload,
    subqueryload,
    undefer,
    undefer_group,
    with_expression,
)


def fn(loadopt: Load, *args: object) -> loader_option:
    return loader_option()


# Testing that the function and return type of function are actually all instances of "loader_option"
assert_type(contains_eager, loader_option)
assert_type(contains_eager(fn), loader_option)
assert_type(load_only, loader_option)
assert_type(load_only(fn), loader_option)
assert_type(joinedload, loader_option)
assert_type(joinedload(fn), loader_option)
assert_type(subqueryload, loader_option)
assert_type(subqueryload(fn), loader_option)
assert_type(selectinload, loader_option)
assert_type(selectinload(fn), loader_option)
assert_type(lazyload, loader_option)
assert_type(lazyload(fn), loader_option)
assert_type(immediateload, loader_option)
assert_type(immediateload(fn), loader_option)
assert_type(noload, loader_option)
assert_type(noload(fn), loader_option)
assert_type(raiseload, loader_option)
assert_type(raiseload(fn), loader_option)
assert_type(defaultload, loader_option)
assert_type(defaultload(fn), loader_option)
assert_type(defer, loader_option)
assert_type(defer(fn), loader_option)
assert_type(undefer, loader_option)
assert_type(undefer(fn), loader_option)
assert_type(undefer_group, loader_option)
assert_type(undefer_group(fn), loader_option)
assert_type(with_expression, loader_option)
assert_type(with_expression(fn), loader_option)
assert_type(selectin_polymorphic, loader_option)
assert_type(selectin_polymorphic(fn), loader_option)
