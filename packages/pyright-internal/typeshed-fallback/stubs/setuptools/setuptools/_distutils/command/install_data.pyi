from _typeshed import Incomplete

from ..cmd import Command

class install_data(Command):
    description: str
    user_options: Incomplete
    boolean_options: Incomplete
    install_dir: Incomplete
    outfiles: Incomplete
    root: Incomplete
    force: bool
    data_files: Incomplete
    warn_dir: bool
    def initialize_options(self) -> None: ...
    def finalize_options(self) -> None: ...
    def run(self) -> None: ...
    def get_inputs(self): ...
    def get_outputs(self): ...
