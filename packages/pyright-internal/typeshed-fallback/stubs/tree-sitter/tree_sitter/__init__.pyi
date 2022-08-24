import ctypes
from _typeshed import StrPath
from collections.abc import Sequence

# Query is missing at runtime for some reason
from tree_sitter.binding import Node as Node, Parser as Parser, Tree as Tree, TreeCursor as TreeCursor

class Language:
    @staticmethod
    def build_library(output_path: str, repo_paths: Sequence[StrPath]) -> bool: ...
    name: str
    lib: ctypes.CDLL
    language_id: int
    # library_path is passed into ctypes LoadLibrary
    def __init__(self, library_path: str, name: str) -> None: ...
    def field_id_for_name(self, name): ...
    def query(self, source): ...
