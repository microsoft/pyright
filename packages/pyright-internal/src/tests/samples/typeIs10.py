# This sample preserves legacy forward equality guards against bare classes.

import ast
from collections.abc import Sequence
from typing import Any, assert_type


def ast_name(node: ast.Call) -> str:
    if type(node.func) == ast.Name:
        return node.func.id
    return ""


def ast_name_negative(node: ast.Call) -> str:
    if type(node.func) != ast.Name:
        return ""
    return node.func.id


class Expr:
    args: tuple[object, ...]


class MatAdd(Expr):
    pass


def matrix_expression(value: Expr | Sequence[object]) -> tuple[object, ...]:
    assert type(value) == MatAdd
    return value.args


class Resource:
    pass


class TaggedResource(Resource):
    tag: str


def resources(values: list[Resource]) -> list[str]:
    return [value.tag for value in values if type(value) == TaggedResource]


def bare_generic(value: list[int] | str):
    if type(value) == list:
        assert_type(value, list[int])


def gradual(value: Any):
    if type(value) == int:
        assert_type(value, int)
    else:
        assert_type(value, Any)


Alias = list[int]


def generic_alias(value: list[str] | dict[str, int]):
    if type(value) == Alias:
        assert_type(value, list[str] | dict[str, int])
