from typing import Any

from markdown.extensions import Extension

class LegacyEmExtension(Extension): ...

# kwargs are config key/value pairs, where the value type depends on the key.
def makeExtension(**kwargs: Any) -> LegacyEmExtension: ...
