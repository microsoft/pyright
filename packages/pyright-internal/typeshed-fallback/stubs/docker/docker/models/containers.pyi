import datetime
from _typeshed import Incomplete
from typing import Literal, NamedTuple, overload

from docker.types.daemon import CancellableStream

from .images import Image
from .resource import Collection, Model

class Container(Model):
    @property
    def name(self) -> str | None: ...
    @property
    def image(self) -> Image | None: ...
    @property
    def labels(self): ...
    @property
    def status(self) -> str: ...
    @property
    def health(self) -> str: ...
    @property
    def ports(self) -> dict[Incomplete, Incomplete]: ...
    def attach(self, **kwargs): ...
    def attach_socket(self, **kwargs): ...
    def commit(self, repository: str | None = None, tag: str | None = None, **kwargs): ...
    def diff(self): ...
    def exec_run(
        self,
        cmd,
        stdout: bool = True,
        stderr: bool = True,
        stdin: bool = False,
        tty: bool = False,
        privileged: bool = False,
        user: str = "",
        detach: bool = False,
        stream: bool = False,
        socket: bool = False,
        environment: Incomplete | None = None,
        workdir: Incomplete | None = None,
        demux: bool = False,
    ) -> ExecResult: ...
    def export(self, chunk_size: int | None = 2097152) -> str: ...
    def get_archive(
        self, path, chunk_size: int | None = 2097152, encode_stream: bool = False
    ) -> tuple[Incomplete, Incomplete]: ...
    def kill(self, signal: Incomplete | None = None): ...
    @overload
    def logs(
        self,
        *,
        stdout: bool = True,
        stderr: bool = True,
        stream: Literal[True],
        timestamps: bool = False,
        tail: Literal["all"] | int = "all",
        since: datetime.datetime | float | None = None,
        follow: bool | None = None,
        until: datetime.datetime | float | None = None,
    ) -> CancellableStream: ...
    @overload
    def logs(
        self,
        *,
        stdout: bool = True,
        stderr: bool = True,
        stream: Literal[False] = False,
        timestamps: bool = False,
        tail: Literal["all"] | int = "all",
        since: datetime.datetime | float | None = None,
        follow: bool | None = None,
        until: datetime.datetime | float | None = None,
    ) -> bytes: ...
    def pause(self) -> None: ...
    def put_archive(self, path: str, data) -> bool: ...
    def remove(self, *, v: bool = False, link: bool = False, force: bool = False) -> None: ...
    def rename(self, name: str): ...
    def resize(self, height: int, width: int): ...
    def restart(self, *, timeout: float | None = 10): ...
    def start(self) -> None: ...
    def stats(self, **kwargs): ...
    def stop(self, *, timeout: float | None = None) -> None: ...
    def top(self, *, ps_args: str | None = None) -> str: ...
    def unpause(self): ...
    def update(
        self,
        *,
        blkio_weight: int | None = None,
        cpu_period: int | None = None,
        cpu_quota: int | None = None,
        cpu_shares: int | None = None,
        cpuset_cpus: str | None = None,
        cpuset_mems: str | None = None,
        mem_limit: float | str | None = None,
        mem_reservation: float | str | None = None,
        memswap_limit: int | str | None = None,
        kernel_memory: int | str | None = None,
        restart_policy: Incomplete | None = None,
    ): ...
    def wait(self, *, timeout: float | None = None, condition: Literal["not-running", "next-exit", "removed"] | None = None): ...

class ContainerCollection(Collection[Container]):
    model: type[Container]
    @overload
    def run(
        self,
        image: str | Image,
        command: str | list[str] | None = None,
        stdout: bool = True,
        stderr: bool = False,
        remove: bool = False,
        *,
        detach: Literal[False] = False,
        **kwargs,
    ) -> bytes: ...
    @overload
    def run(
        self,
        image: str | Image,
        command: str | list[str] | None = None,
        stdout: bool = True,
        stderr: bool = False,
        remove: bool = False,
        *,
        detach: Literal[True],
        **kwargs,
    ) -> Container: ...
    def create(self, image: str, command: str | list[str] | None = None, **kwargs) -> Container: ...  # type:ignore[override]
    def get(self, container_id: str) -> Container: ...
    def list(
        self,
        all: bool = False,
        before: str | None = None,
        filters: Incomplete | None = None,
        limit: int = -1,
        since: str | None = None,
        sparse: bool = False,
        ignore_removed: bool = False,
    ): ...
    def prune(self, filters: Incomplete | None = None): ...

RUN_CREATE_KWARGS: list[str]
RUN_HOST_CONFIG_KWARGS: list[str]

class ExecResult(NamedTuple):
    exit_code: Incomplete
    output: Incomplete
