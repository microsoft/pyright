# PYZ, EXE and COLLECT referenced in https://pyinstaller.org/en/stable/spec-files.html#spec-file-operation
# MERGE is referenced in https://pyinstaller.org/en/stable/spec-files.html#example-merge-spec-file
# Not to be imported during runtime, but is the type reference for spec files which are executed as python code
import sys
from _typeshed import FileDescriptorOrPath, StrOrBytesPath, StrPath, Unused
from collections.abc import Iterable, Mapping, Sequence
from types import CodeType
from typing import ClassVar
from typing_extensions import Final, Literal, TypeAlias

from PyInstaller.building import _PyiBlockCipher
from PyInstaller.building.build_main import Analysis
from PyInstaller.building.datastruct import TOC, Target, _TOCTuple
from PyInstaller.building.splash import Splash
from PyInstaller.utils.win32.versioninfo import VSVersionInfo
from PyInstaller.utils.win32.winmanifest import Manifest

if sys.platform == "darwin":
    _TargetArch: TypeAlias = Literal["x86_64", "arm64", "universal2"]
    _SuportedTargetArchParam: TypeAlias = _TargetArch | None
    _CodesignIdentity: TypeAlias = str | None
    _CodesignIdentityParam: TypeAlias = str | None
else:
    _TargetArch: TypeAlias = None
    _SuportedTargetArchParam: TypeAlias = object
    _CodesignIdentity: TypeAlias = None
    _CodesignIdentityParam: TypeAlias = object

if sys.platform == "win32":
    _Icon: TypeAlias = list[StrPath] | str
    _IconParam: TypeAlias = StrPath | list[StrPath] | None
elif sys.platform == "darwin":
    _Icon: TypeAlias = list[StrPath] | None
    _IconParam: TypeAlias = StrPath | list[StrPath] | None
else:
    _Icon: TypeAlias = None
    _IconParam: TypeAlias = object

if sys.platform == "win32":
    _VersionSrc: TypeAlias = VSVersionInfo | None
    _VersionParam: TypeAlias = VSVersionInfo | StrOrBytesPath | None
    _Manifest: TypeAlias = Manifest
    _ManifestParam: TypeAlias = Manifest | None
else:
    _VersionSrc: TypeAlias = None
    _VersionParam: TypeAlias = object
    _Manifest: TypeAlias = None
    _ManifestParam: TypeAlias = object

class PYZ(Target):
    name: str
    cipher: _PyiBlockCipher
    dependencies: list[_TOCTuple]  # type: ignore[assignment]
    toc: TOC
    code_dict: dict[str, CodeType]
    def __init__(self, *tocs: TOC, name: str | None = None, cipher: _PyiBlockCipher = None) -> None: ...
    def assemble(self) -> None: ...

class PKG(Target):
    xformdict: ClassVar[dict[str, str]]
    toc: TOC
    cdict: Mapping[str, bool]
    name: str
    exclude_binaries: bool
    strip_binaries: bool
    upx_binaries: bool
    upx_exclude: Iterable[str]
    target_arch: _TargetArch | None
    codesign_identity: _CodesignIdentity
    entitlements_file: FileDescriptorOrPath | None
    def __init__(
        self,
        toc: TOC,
        name: str | None = None,
        cdict: Mapping[str, bool] | None = None,
        exclude_binaries: bool = False,
        strip_binaries: bool = False,
        upx_binaries: bool = False,
        upx_exclude: Iterable[str] | None = None,
        target_arch: _SuportedTargetArchParam = None,
        codesign_identity: _CodesignIdentityParam = None,
        entitlements_file: FileDescriptorOrPath | None = None,
    ) -> None: ...
    def assemble(self) -> None: ...

class EXE(Target):
    exclude_binaries: bool
    bootloader_ignore_signals: bool
    console: bool
    disable_windowed_traceback: bool
    debug: bool
    name: str
    icon: _Icon
    versrsrc: _VersionSrc
    manifest: _Manifest
    embed_manifest: bool
    resources: Sequence[str]
    strip: bool
    upx_exclude: Iterable[str]
    runtime_tmpdir: str | None
    append_pkg: bool
    uac_admin: bool
    uac_uiaccess: bool
    argv_emulation: bool
    target_arch: _TargetArch
    codesign_identity: _CodesignIdentity
    entitlements_file: FileDescriptorOrPath | None
    upx: bool
    pkgname: str
    toc: TOC
    pkg: PKG
    dependencies: TOC
    exefiles: TOC
    def __init__(
        self,
        *args: Iterable[_TOCTuple] | PYZ | Splash,
        exclude_binaries: bool = False,
        bootloader_ignore_signals: bool = False,
        console: bool = True,
        disable_windowed_traceback: bool = False,
        debug: bool = False,
        name: str | None = None,
        icon: _IconParam = None,
        version: _VersionParam = None,
        manifest: _ManifestParam = None,
        embed_manifest: bool = True,
        resources: Sequence[str] = ...,
        strip: bool = False,
        upx_exclude: Iterable[str] = ...,
        runtime_tmpdir: str | None = None,
        append_pkg: bool = True,
        uac_admin: bool = False,
        uac_uiaccess: bool = False,
        argv_emulation: bool = False,
        target_arch: _SuportedTargetArchParam = None,
        codesign_identity: _CodesignIdentityParam = None,
        entitlements_file: FileDescriptorOrPath | None = None,
        upx: bool = False,
        cdict: Mapping[str, bool] | None = None,
    ) -> None: ...
    mtm: float
    def assemble(self) -> None: ...

class COLLECT(Target):
    strip_binaries: bool
    upx_exclude: Iterable[str]
    console: bool
    target_arch: _TargetArch | None
    codesign_identity: _CodesignIdentity
    entitlements_file: FileDescriptorOrPath | None
    upx_binaries: bool
    name: str
    toc: TOC
    def __init__(
        self,
        *args: Iterable[_TOCTuple] | EXE,
        strip: bool = False,
        upx_exclude: Iterable[str] = ...,
        upx: bool = False,
        name: str,
    ) -> None: ...
    def assemble(self) -> None: ...

class MERGE:
    def __init__(self, *args: tuple[Analysis, Unused, str]) -> None: ...

UNCOMPRESSED: Final = False
COMPRESSED: Final = True
