# This sample tests the case that exercises some of the heuristics that
# determine whether TypeVar matching should retain a literal type.

from typing import Dict, Literal


FileChanges = Dict[str, Literal["created", "edited", "removed"]]

changes: FileChanges = {}
changes.update({filename: "removed" for filename in ["foo.py", "bar.py"]})
