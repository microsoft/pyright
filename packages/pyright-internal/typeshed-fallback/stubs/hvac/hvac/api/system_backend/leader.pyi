from hvac.api.system_backend.system_backend_mixin import SystemBackendMixin

class Leader(SystemBackendMixin):
    def read_leader_status(self): ...
    def step_down(self): ...
