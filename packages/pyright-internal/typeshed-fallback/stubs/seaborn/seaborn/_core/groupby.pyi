from _typeshed import Incomplete
from collections.abc import Callable

from pandas import DataFrame

class GroupBy:
    order: dict[str, list[Incomplete] | None]
    def __init__(self, order: list[str] | dict[str, list[Incomplete] | None]) -> None: ...
    def agg(self, data: DataFrame, *args, **kwargs) -> DataFrame: ...
    def apply(self, data: DataFrame, func: Callable[..., DataFrame], *args, **kwargs) -> DataFrame: ...
