# Runtime sentinel names and custom repr must retain ordinary constructor diagnostics.

import sys
from typing import TypeAlias

if sys.version_info >= (3, 15):
    from builtins import sentinel
else:
    from typing_extensions import sentinel  # pyright: ignore[reportMissingModuleSource]


def invalid(name: str, number: int, optional: str | None) -> None:
    sentinel()
    sentinel(name, name)
    sentinel(name, repr=number)
    sentinel(number, repr=name)
    sentinel(optional, repr=name)
    sentinel(name, unknown=name)
    sentinel(name=name)


def get_name() -> str:
    return "runtime"


dynamic = sentinel(get_name(), repr="<runtime>")
names: tuple[str] = (get_name(),)
keyword_first = sentinel(repr="<runtime>", *names)

# These should generate errors because runtime instances are not singleton type forms.
bad_annotation: dynamic
bad_alias: TypeAlias = dynamic
type BadAlias = keyword_first

MISSING = sentinel("MISSING", repr="<MISSING>")
OTHER = sentinel("OTHER", repr=None)


def use_missing(value: MISSING) -> None:
    pass


use_missing(MISSING)
# These should generate errors because only the declared singleton is accepted.
use_missing(OTHER)
use_missing(dynamic)
use_missing(keyword_first)
