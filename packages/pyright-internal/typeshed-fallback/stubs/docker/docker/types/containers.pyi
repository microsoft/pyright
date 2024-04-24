from _typeshed import Incomplete

from .base import DictType

class LogConfigTypesEnum:
    JSON: Incomplete
    SYSLOG: Incomplete
    JOURNALD: Incomplete
    GELF: Incomplete
    FLUENTD: Incomplete
    NONE: Incomplete

class LogConfig(DictType):
    types: type[LogConfigTypesEnum]
    def __init__(self, **kwargs) -> None: ...
    @property
    def type(self): ...
    @type.setter
    def type(self, value) -> None: ...
    @property
    def config(self): ...
    def set_config_value(self, key, value) -> None: ...
    def unset_config(self, key) -> None: ...

class Ulimit(DictType):
    def __init__(self, **kwargs) -> None: ...
    @property
    def name(self): ...
    @name.setter
    def name(self, value) -> None: ...
    @property
    def soft(self): ...
    @soft.setter
    def soft(self, value) -> None: ...
    @property
    def hard(self): ...
    @hard.setter
    def hard(self, value) -> None: ...

class DeviceRequest(DictType):
    def __init__(self, **kwargs) -> None: ...
    @property
    def driver(self): ...
    @driver.setter
    def driver(self, value) -> None: ...
    @property
    def count(self): ...
    @count.setter
    def count(self, value) -> None: ...
    @property
    def device_ids(self): ...
    @device_ids.setter
    def device_ids(self, value) -> None: ...
    @property
    def capabilities(self): ...
    @capabilities.setter
    def capabilities(self, value) -> None: ...
    @property
    def options(self): ...
    @options.setter
    def options(self, value) -> None: ...

class HostConfig(dict[str, Incomplete]):
    def __init__(
        self,
        version,
        binds: Incomplete | None = None,
        port_bindings: Incomplete | None = None,
        lxc_conf: Incomplete | None = None,
        publish_all_ports: bool = False,
        links: Incomplete | None = None,
        privileged: bool = False,
        dns: Incomplete | None = None,
        dns_search: Incomplete | None = None,
        volumes_from: Incomplete | None = None,
        network_mode: Incomplete | None = None,
        restart_policy: Incomplete | None = None,
        cap_add: Incomplete | None = None,
        cap_drop: Incomplete | None = None,
        devices: Incomplete | None = None,
        extra_hosts: Incomplete | None = None,
        read_only: Incomplete | None = None,
        pid_mode: Incomplete | None = None,
        ipc_mode: Incomplete | None = None,
        security_opt: Incomplete | None = None,
        ulimits: Incomplete | None = None,
        log_config: Incomplete | None = None,
        mem_limit: Incomplete | None = None,
        memswap_limit: Incomplete | None = None,
        mem_reservation: Incomplete | None = None,
        kernel_memory: Incomplete | None = None,
        mem_swappiness: Incomplete | None = None,
        cgroup_parent: Incomplete | None = None,
        group_add: Incomplete | None = None,
        cpu_quota: Incomplete | None = None,
        cpu_period: Incomplete | None = None,
        blkio_weight: Incomplete | None = None,
        blkio_weight_device: Incomplete | None = None,
        device_read_bps: Incomplete | None = None,
        device_write_bps: Incomplete | None = None,
        device_read_iops: Incomplete | None = None,
        device_write_iops: Incomplete | None = None,
        oom_kill_disable: bool = False,
        shm_size: Incomplete | None = None,
        sysctls: Incomplete | None = None,
        tmpfs: Incomplete | None = None,
        oom_score_adj: Incomplete | None = None,
        dns_opt: Incomplete | None = None,
        cpu_shares: Incomplete | None = None,
        cpuset_cpus: Incomplete | None = None,
        userns_mode: Incomplete | None = None,
        uts_mode: Incomplete | None = None,
        pids_limit: Incomplete | None = None,
        isolation: Incomplete | None = None,
        auto_remove: bool = False,
        storage_opt: Incomplete | None = None,
        init: Incomplete | None = None,
        init_path: Incomplete | None = None,
        volume_driver: Incomplete | None = None,
        cpu_count: Incomplete | None = None,
        cpu_percent: Incomplete | None = None,
        nano_cpus: Incomplete | None = None,
        cpuset_mems: Incomplete | None = None,
        runtime: Incomplete | None = None,
        mounts: Incomplete | None = None,
        cpu_rt_period: Incomplete | None = None,
        cpu_rt_runtime: Incomplete | None = None,
        device_cgroup_rules: Incomplete | None = None,
        device_requests: Incomplete | None = None,
        cgroupns: Incomplete | None = None,
    ) -> None: ...

def host_config_type_error(param, param_value, expected): ...
def host_config_version_error(param, version, less_than: bool = True): ...
def host_config_value_error(param, param_value): ...
def host_config_incompatible_error(param, param_value, incompatible_param): ...

class ContainerConfig(dict[str, Incomplete]):
    def __init__(
        self,
        version,
        image,
        command,
        hostname: Incomplete | None = None,
        user: Incomplete | None = None,
        detach: bool = False,
        stdin_open: bool = False,
        tty: bool = False,
        ports: Incomplete | None = None,
        environment: Incomplete | None = None,
        volumes: Incomplete | None = None,
        network_disabled: bool = False,
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
    ) -> None: ...
