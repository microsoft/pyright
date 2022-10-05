from collections.abc import Callable, Mapping, Sequence
from typing import Any

from consolemenu.console_menu import ConsoleMenu
from consolemenu.items import ExternalItem as ExternalItem

class FunctionItem(ExternalItem):
    function: Callable[..., Any]
    args: Sequence[Any]
    kwargs: Mapping[str, Any]
    return_value: Any | None
    def __init__(
        self,
        text: str,
        function: Callable[..., Any],
        args: Sequence[Any] | None = ...,
        kwargs: Mapping[str, Any] | None = ...,
        menu: ConsoleMenu | None = ...,
        should_exit: bool = ...,
    ) -> None: ...
    def action(self) -> None: ...
    def clean_up(self) -> None: ...
    def get_return(self) -> Any | None: ...
