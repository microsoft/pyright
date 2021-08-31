from collections import OrderedDict
from typing import Any, Iterator, List

from .locale import Locale

LOCALE_SPLIT_PATTERN: Any

class LocaleDataLoader:
    def get_locale_map(
        self,
        languages: List[str] | None = ...,
        locales: List[str] | None = ...,
        region: str | None = ...,
        use_given_order: bool = ...,
        allow_conflicting_locales: bool = ...,
    ) -> OrderedDict[str, List[Any] | str | int]: ...
    def get_locales(
        self,
        languages: List[str] | None = ...,
        locales: List[str] | None = ...,
        region: str | None = ...,
        use_given_order: bool = ...,
        allow_conflicting_locales: bool = ...,
    ) -> Iterator[Locale]: ...
    def get_locale(self, shortname: str) -> Locale: ...

default_loader: Any
