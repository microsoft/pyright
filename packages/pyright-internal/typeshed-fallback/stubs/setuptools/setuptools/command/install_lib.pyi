from _typeshed import StrPath, Unused
from typing import Literal

from .._distutils.command import install_lib as orig

class install_lib(orig.install_lib):
    def run(self) -> None: ...
    def get_exclusions(self): ...
    def copy_tree(
        self,
        infile: StrPath,
        outfile: str,
        preserve_mode: bool | Literal[0, 1] = 1,
        preserve_times: bool | Literal[0, 1] = 1,
        preserve_symlinks: bool | Literal[0, 1] = 0,
        level: Unused = 1,
    ): ...
    def get_outputs(self): ...
