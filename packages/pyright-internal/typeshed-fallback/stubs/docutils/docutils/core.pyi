from _typeshed import Incomplete

from docutils.writers import _WriterParts

__docformat__: str

class Publisher:
    document: Incomplete
    reader: Incomplete
    parser: Incomplete
    writer: Incomplete
    source: Incomplete
    source_class: Incomplete
    destination: Incomplete
    destination_class: Incomplete
    settings: Incomplete
    def __init__(
        self,
        reader: Incomplete | None = None,
        parser: Incomplete | None = None,
        writer: Incomplete | None = None,
        source: Incomplete | None = None,
        source_class=...,
        destination: Incomplete | None = None,
        destination_class=...,
        settings: Incomplete | None = None,
    ) -> None: ...
    def set_reader(self, reader_name, parser, parser_name) -> None: ...
    def set_writer(self, writer_name) -> None: ...
    def set_components(self, reader_name, parser_name, writer_name) -> None: ...
    def setup_option_parser(
        self,
        usage: Incomplete | None = None,
        description: Incomplete | None = None,
        settings_spec: Incomplete | None = None,
        config_section: Incomplete | None = None,
        **defaults,
    ): ...
    def get_settings(
        self,
        usage: Incomplete | None = None,
        description: Incomplete | None = None,
        settings_spec: Incomplete | None = None,
        config_section: Incomplete | None = None,
        **defaults,
    ): ...
    def process_programmatic_settings(self, settings_spec, settings_overrides, config_section) -> None: ...
    def process_command_line(
        self,
        argv: Incomplete | None = None,
        usage: Incomplete | None = None,
        description: Incomplete | None = None,
        settings_spec: Incomplete | None = None,
        config_section: Incomplete | None = None,
        **defaults,
    ) -> None: ...
    def set_io(self, source_path: Incomplete | None = None, destination_path: Incomplete | None = None) -> None: ...
    def set_source(self, source: Incomplete | None = None, source_path: Incomplete | None = None) -> None: ...
    def set_destination(self, destination: Incomplete | None = None, destination_path: Incomplete | None = None) -> None: ...
    def apply_transforms(self) -> None: ...
    def publish(
        self,
        argv: Incomplete | None = None,
        usage: Incomplete | None = None,
        description: Incomplete | None = None,
        settings_spec: Incomplete | None = None,
        settings_overrides: Incomplete | None = None,
        config_section: Incomplete | None = None,
        enable_exit_status: bool = False,
    ): ...
    def debugging_dumps(self) -> None: ...
    def prompt(self) -> None: ...
    def report_Exception(self, error) -> None: ...
    def report_SystemMessage(self, error) -> None: ...
    def report_UnicodeError(self, error) -> None: ...

default_usage: str
default_description: str

def publish_cmdline(
    reader: Incomplete | None = None,
    reader_name: str = "standalone",
    parser: Incomplete | None = None,
    parser_name: str = "restructuredtext",
    writer: Incomplete | None = None,
    writer_name: str = "pseudoxml",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = True,
    argv: Incomplete | None = None,
    usage=...,
    description=...,
): ...
def publish_file(
    source: Incomplete | None = None,
    source_path: Incomplete | None = None,
    destination: Incomplete | None = None,
    destination_path: Incomplete | None = None,
    reader: Incomplete | None = None,
    reader_name: str = "standalone",
    parser: Incomplete | None = None,
    parser_name: str = "restructuredtext",
    writer: Incomplete | None = None,
    writer_name: str = "pseudoxml",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = False,
): ...
def publish_string(
    source,
    source_path: Incomplete | None = None,
    destination_path: Incomplete | None = None,
    reader: Incomplete | None = None,
    reader_name: str = "standalone",
    parser: Incomplete | None = None,
    parser_name: str = "restructuredtext",
    writer: Incomplete | None = None,
    writer_name: str = "pseudoxml",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = False,
): ...
def publish_parts(
    source,
    source_path: Incomplete | None = None,
    source_class=...,
    destination_path: Incomplete | None = None,
    reader: Incomplete | None = None,
    reader_name: str = "standalone",
    parser: Incomplete | None = None,
    parser_name: str = "restructuredtext",
    writer: Incomplete | None = None,
    writer_name: str = "pseudoxml",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = False,
) -> _WriterParts: ...
def publish_doctree(
    source,
    source_path: Incomplete | None = None,
    source_class=...,
    reader: Incomplete | None = None,
    reader_name: str = "standalone",
    parser: Incomplete | None = None,
    parser_name: str = "restructuredtext",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = False,
): ...
def publish_from_doctree(
    document,
    destination_path: Incomplete | None = None,
    writer: Incomplete | None = None,
    writer_name: str = "pseudoxml",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = False,
): ...
def publish_cmdline_to_binary(
    reader: Incomplete | None = None,
    reader_name: str = "standalone",
    parser: Incomplete | None = None,
    parser_name: str = "restructuredtext",
    writer: Incomplete | None = None,
    writer_name: str = "pseudoxml",
    settings: Incomplete | None = None,
    settings_spec: Incomplete | None = None,
    settings_overrides: Incomplete | None = None,
    config_section: Incomplete | None = None,
    enable_exit_status: bool = True,
    argv: Incomplete | None = None,
    usage=...,
    description=...,
    destination: Incomplete | None = None,
    destination_class=...,
): ...
def publish_programmatically(
    source_class,
    source,
    source_path,
    destination_class,
    destination,
    destination_path,
    reader,
    reader_name,
    parser,
    parser_name,
    writer,
    writer_name,
    settings,
    settings_spec,
    settings_overrides,
    config_section,
    enable_exit_status,
): ...
def rst2something(writer, documenttype, doc_path: str = "") -> None: ...
def rst2html() -> None: ...
def rst2html4() -> None: ...
def rst2html5() -> None: ...
def rst2latex() -> None: ...
def rst2man() -> None: ...
def rst2odt() -> None: ...
def rst2pseudoxml() -> None: ...
def rst2s5() -> None: ...
def rst2xetex() -> None: ...
def rst2xml() -> None: ...
