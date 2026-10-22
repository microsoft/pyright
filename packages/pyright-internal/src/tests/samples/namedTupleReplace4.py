# This sample tests stored descriptor field types in NamedTuple replacements.

import sys
from typing import NamedTuple


class Descriptor:
    def __set__(self, instance: object, value: int) -> None:
        pass


class Row(NamedTuple):
    item: Descriptor


FactoryRow = NamedTuple("FactoryRow", [("item", Descriptor)])


def func1(row: Row, factory_row: FactoryRow, item: Descriptor):
    reveal_type(Row(item), expected_text="Row")
    reveal_type(row._replace(item=item), expected_text="Row")
    reveal_type(factory_row._replace(item=item), expected_text="FactoryRow")

    # This should generate an error.
    row._replace(item=1)

    # This should generate an error.
    factory_row._replace(item=1)

    if sys.version_info >= (3, 13):
        reveal_type(row.__replace__(item=item), expected_text="Row")
        reveal_type(factory_row.__replace__(item=item), expected_text="FactoryRow")

        # This should generate an error.
        row.__replace__(item=1)

        # This should generate an error.
        factory_row.__replace__(item=1)
