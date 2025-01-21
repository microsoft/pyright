from binascii import Incomplete
from typing import ClassVar, Final

from .ccompiler import CCompiler

PLAT_SPEC_TO_RUNTIME: Final[dict[str, str]]

class MSVCCompiler(CCompiler):
    compiler_type: ClassVar[str]
    executables: ClassVar[dict[Incomplete, Incomplete]]
    src_extensions: ClassVar[list[str]]
    res_extension: ClassVar[str]
    obj_extension: ClassVar[str]
    static_lib_extension: ClassVar[str]
    shared_lib_extension: ClassVar[str]
    shared_lib_format: ClassVar[str]
    static_lib_format = shared_lib_format
    exe_extension: ClassVar[str]
    initialized: bool
    def initialize(self, plat_name: str | None = None) -> None: ...
    @property
    def out_extensions(self) -> dict[str, str]: ...
