from _typeshed import Incomplete

class ContainerApiMixin:
    def attach(
        self, container, stdout: bool = True, stderr: bool = True, stream: bool = False, logs: bool = False, demux: bool = False
    ): ...
    def attach_socket(self, container, params: Incomplete | None = None, ws: bool = False): ...
    def commit(
        self,
        container,
        repository: str | None = None,
        tag: str | None = None,
        message: Incomplete | None = None,
        author: Incomplete | None = None,
        pause: bool = True,
        changes: Incomplete | None = None,
        conf: Incomplete | None = None,
    ): ...
    def containers(
        self,
        quiet: bool = False,
        all: bool = False,
        trunc: bool = False,
        latest: bool = False,
        since: Incomplete | None = None,
        before: Incomplete | None = None,
        limit: int = -1,
        size: bool = False,
        filters: Incomplete | None = None,
    ): ...
    def create_container(
        self,
        image,
        command: Incomplete | None = None,
        hostname: Incomplete | None = None,
        user: Incomplete | None = None,
        detach: bool = False,
        stdin_open: bool = False,
        tty: bool = False,
        ports: Incomplete | None = None,
        environment: Incomplete | None = None,
        volumes: Incomplete | None = None,
        network_disabled: bool = False,
        name: Incomplete | None = None,
        entrypoint: Incomplete | None = None,
        working_dir: Incomplete | None = None,
        domainname: Incomplete | None = None,
        host_config: Incomplete | None = None,
        mac_address: Incomplete | None = None,
        labels: Incomplete | None = None,
        stop_signal: Incomplete | None = None,
        networking_config: Incomplete | None = None,
        healthcheck: Incomplete | None = None,
        stop_timeout: Incomplete | None = None,
        runtime: Incomplete | None = None,
        use_config_proxy: bool = True,
        platform: Incomplete | None = None,
    ): ...
    def create_container_config(self, *args, **kwargs): ...
    def create_container_from_config(self, config, name: Incomplete | None = None, platform: Incomplete | None = None): ...
    def create_host_config(self, *args, **kwargs): ...
    def create_networking_config(self, *args, **kwargs): ...
    def create_endpoint_config(self, *args, **kwargs): ...
    def diff(self, container): ...
    def export(self, container, chunk_size=2097152): ...
    def get_archive(self, container, path, chunk_size=2097152, encode_stream: bool = False): ...
    def inspect_container(self, container): ...
    def kill(self, container, signal: Incomplete | None = None) -> None: ...
    def logs(
        self,
        container,
        stdout: bool = True,
        stderr: bool = True,
        stream: bool = False,
        timestamps: bool = False,
        tail: str = "all",
        since: Incomplete | None = None,
        follow: Incomplete | None = None,
        until: Incomplete | None = None,
    ): ...
    def pause(self, container) -> None: ...
    def port(self, container, private_port): ...
    def put_archive(self, container, path, data): ...
    def prune_containers(self, filters: Incomplete | None = None): ...
    def remove_container(self, container, v: bool = False, link: bool = False, force: bool = False) -> None: ...
    def rename(self, container, name) -> None: ...
    def resize(self, container, height, width) -> None: ...
    def restart(self, container, timeout: int = 10) -> None: ...
    def start(self, container, *args, **kwargs) -> None: ...
    def stats(self, container, decode: Incomplete | None = None, stream: bool = True, one_shot: Incomplete | None = None): ...
    def stop(self, container, timeout: Incomplete | None = None) -> None: ...
    def top(self, container, ps_args: Incomplete | None = None): ...
    def unpause(self, container) -> None: ...
    def update_container(
        self,
        container,
        blkio_weight: Incomplete | None = None,
        cpu_period: Incomplete | None = None,
        cpu_quota: Incomplete | None = None,
        cpu_shares: Incomplete | None = None,
        cpuset_cpus: Incomplete | None = None,
        cpuset_mems: Incomplete | None = None,
        mem_limit: Incomplete | None = None,
        mem_reservation: Incomplete | None = None,
        memswap_limit: Incomplete | None = None,
        kernel_memory: Incomplete | None = None,
        restart_policy: Incomplete | None = None,
    ): ...
    def wait(self, container, timeout: Incomplete | None = None, condition: Incomplete | None = None): ...
