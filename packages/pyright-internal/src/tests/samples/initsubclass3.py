# This sample tests a case where a circular dependency in
# ReprEnum causes potential problems if __init_subclass__ is
# validated as part of class type evaluation.

# pyright: reportMissingImports=false

from enum import StrEnum

import click


class Foo(StrEnum):
    bar = "bar"
    baz = "baz"


some_foos = {Foo.bar, Foo.baz}


@click.command
def cli():
    ...


reveal_type(Foo.bar, expected_text="Literal[Foo.bar]")
reveal_type(some_foos, expected_text="set[Foo]")
