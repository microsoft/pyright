from typing import Any, ClassVar, NamedTuple, Optional, Tuple

__docformat__: str
__version__: str

class _VersionInfo(NamedTuple):
    major: int
    minor: int
    micro: int
    releaselevel: str
    serial: int
    release: bool

class VersionInfo(_VersionInfo):
    def __new__(
        cls, major: int = ..., minor: int = ..., micro: int = ..., releaselevel: str = ..., serial: int = ..., release: bool = ...
    ) -> VersionInfo: ...

__version_info__: VersionInfo
__version_details__: str

class ApplicationError(Exception): ...
class DataError(ApplicationError): ...

class SettingsSpec:
    settings_spec: ClassVar[Tuple[Any, ...]]
    settings_defaults: ClassVar[Optional[dict[Any, Any]]]
    settings_default_overrides: ClassVar[Optional[dict[Any, Any]]]
    relative_path_settings: ClassVar[Tuple[Any, ...]]
    config_section: ClassVar[Optional[str]]
    config_section_dependencies: ClassVar[Optional[Tuple[str, ...]]]

class TransformSpec:
    def get_transforms(self) -> list[Any]: ...
    default_transforms: ClassVar[Tuple[Any, ...]]
    unknown_reference_resolvers: ClassVar[list[Any]]

class Component(SettingsSpec, TransformSpec):
    component_type: ClassVar[Optional[str]]
    supported: ClassVar[Tuple[str, ...]]
    def supports(self, format: str) -> bool: ...
