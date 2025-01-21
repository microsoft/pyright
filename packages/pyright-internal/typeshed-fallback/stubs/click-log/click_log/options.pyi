import logging
import typing as t
from typing_extensions import TypeAlias

import click

_AnyCallable: TypeAlias = t.Callable[..., t.Any]
_FC = t.TypeVar("_FC", bound=_AnyCallable | click.Command)

def simple_verbosity_option(
    logger: logging.Logger | str | None = None, *names: str, **kwargs: t.Any
) -> t.Callable[[_FC], _FC]: ...
