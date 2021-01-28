from typing import Any, List, Optional, Type

from pyVmomi.vim import ManagedEntity
from pyVmomi.vim.view import ContainerView
from pyVmomi.vmodl import DynamicProperty

class PropertyCollector:
    class PropertySpec:
        def __init__(self, *, all: bool = ..., type: Type[ManagedEntity] = ..., pathSet: List[str] = ...) -> None: ...
        all: bool
        type: Type[ManagedEntity]
        pathSet: List[str]
    class TraversalSpec:
        def __init__(
            self, *, path: str = ..., skip: bool = ..., type: Type[ContainerView] = ..., **kwargs: Any  # incomplete
        ) -> None: ...
        path: str
        skip: bool
        type: Type[ContainerView]
        def __getattr__(self, name: str) -> Any: ...  # incomplete
    class RetrieveOptions:
        def __init__(self, *, maxObjects: int) -> None: ...
        maxObjects: int
    class ObjectSpec:
        def __init__(
            self, *, skip: bool = ..., selectSet: List[PropertyCollector.TraversalSpec] = ..., obj: Any = ...
        ) -> None: ...
        skip: bool
        selectSet: List[PropertyCollector.TraversalSpec]
        obj: Any
    class FilterSpec:
        def __init__(
            self,
            *,
            propSet: List[PropertyCollector.PropertySpec] = ...,
            objectSet: List[PropertyCollector.ObjectSpec] = ...,
            **kwargs: Any,  # incomplete
        ) -> None: ...
        propSet: List[PropertyCollector.PropertySpec]
        objectSet: List[PropertyCollector.ObjectSpec]
        def __getattr__(self, name: str) -> Any: ...  # incomplete
    class ObjectContent:
        def __init__(
            self, *, obj: ManagedEntity = ..., propSet: List[DynamicProperty] = ..., **kwargs: Any  # incomplete
        ) -> None: ...
        obj: ManagedEntity
        propSet: List[DynamicProperty]
        def __getattr__(self, name: str) -> Any: ...  # incomplete
    class RetrieveResult:
        def __init__(self, *, objects: List[PropertyCollector.ObjectContent] = ..., token: Optional[str] = ...) -> None: ...
        objects: List[PropertyCollector.ObjectContent]
        token: Optional[str]
    def RetrievePropertiesEx(
        self, specSet: List[PropertyCollector.FilterSpec], options: PropertyCollector.RetrieveOptions
    ) -> PropertyCollector.RetrieveResult: ...
    def ContinueRetrievePropertiesEx(self, token: str) -> PropertyCollector.RetrieveResult: ...
    def __getattr__(self, name: str) -> Any: ...  # incomplete
