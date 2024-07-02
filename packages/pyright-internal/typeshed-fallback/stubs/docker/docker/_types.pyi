# Internal-use module for types shared by multiple modules.
# This does not match a module in docker-py.

from typing_extensions import TypeAlias

# Type alias for JSON, explained at:
# https://github.com/python/typing/issues/182#issuecomment-1320974824.
JSON: TypeAlias = dict[str, JSON] | list[JSON] | str | int | float | bool | None
