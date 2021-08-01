from typing import Any, Iterable, Optional, Text

ATTRIBUTES: dict[str, int]
COLORS: dict[str, int]
HIGHLIGHTS: dict[str, int]
RESET: str

def colored(
    text: Text, color: Optional[Text] = ..., on_color: Optional[Text] = ..., attrs: Optional[Iterable[Text]] = ...
) -> Text: ...
def cprint(
    text: Text, color: Optional[Text] = ..., on_color: Optional[Text] = ..., attrs: Optional[Iterable[Text]] = ..., **kwargs: Any
) -> None: ...
