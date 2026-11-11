# This sample tests structural compatibility of mutually recursive TypedDicts.

from typing import TypedDict, Union


class AInclude(TypedDict, total=False):
    rel0: Union[bool, "AArgs"]
    rel1: Union[bool, "AArgs"]


class AArgs(TypedDict, total=False):
    include: "AInclude"


class BInclude(TypedDict, total=False):
    rel0: Union[bool, "BArgs"]
    rel1: Union[bool, "BArgs"]


class BArgs(TypedDict, total=False):
    include: "BInclude"


def func(a: AInclude, b: BInclude):
    compatible_b: BInclude = a
    compatible_a: AInclude = b
