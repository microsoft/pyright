import sys
from typing import Any, Callable, Iterator, Sequence, Text, Type

from .bccache import BytecodeCache
from .loaders import BaseLoader
from .runtime import Context, Undefined

if sys.version_info >= (3, 6):
    from typing import AsyncIterator, Awaitable

def get_spontaneous_environment(*args): ...
def create_cache(size): ...
def copy_cache(cache): ...
def load_extensions(environment, extensions): ...

class Environment:
    sandboxed: bool
    overlayed: bool
    linked_to: Any
    shared: bool
    exception_handler: Any
    exception_formatter: Any
    code_generator_class: Any
    context_class: Any
    block_start_string: Text
    block_end_string: Text
    variable_start_string: Text
    variable_end_string: Text
    comment_start_string: Text
    comment_end_string: Text
    line_statement_prefix: Text
    line_comment_prefix: Text
    trim_blocks: bool
    lstrip_blocks: Any
    newline_sequence: Text
    keep_trailing_newline: bool
    undefined: Type[Undefined]
    optimized: bool
    finalize: Callable[..., Any]
    autoescape: Any
    filters: Any
    tests: Any
    globals: dict[str, Any]
    loader: BaseLoader
    cache: Any
    bytecode_cache: BytecodeCache
    auto_reload: bool
    extensions: list[Any]
    def __init__(
        self,
        block_start_string: Text = ...,
        block_end_string: Text = ...,
        variable_start_string: Text = ...,
        variable_end_string: Text = ...,
        comment_start_string: Any = ...,
        comment_end_string: Text = ...,
        line_statement_prefix: Text = ...,
        line_comment_prefix: Text = ...,
        trim_blocks: bool = ...,
        lstrip_blocks: bool = ...,
        newline_sequence: Text = ...,
        keep_trailing_newline: bool = ...,
        extensions: list[Any] = ...,
        optimized: bool = ...,
        undefined: Type[Undefined] = ...,
        finalize: Callable[..., Any] | None = ...,
        autoescape: bool | Callable[[str], bool] = ...,
        loader: BaseLoader | None = ...,
        cache_size: int = ...,
        auto_reload: bool = ...,
        bytecode_cache: BytecodeCache | None = ...,
        enable_async: bool = ...,
    ) -> None: ...
    def add_extension(self, extension): ...
    def extend(self, **attributes): ...
    def overlay(
        self,
        block_start_string: Text = ...,
        block_end_string: Text = ...,
        variable_start_string: Text = ...,
        variable_end_string: Text = ...,
        comment_start_string: Any = ...,
        comment_end_string: Text = ...,
        line_statement_prefix: Text = ...,
        line_comment_prefix: Text = ...,
        trim_blocks: bool = ...,
        lstrip_blocks: bool = ...,
        extensions: list[Any] = ...,
        optimized: bool = ...,
        undefined: Type[Undefined] = ...,
        finalize: Callable[..., Any] = ...,
        autoescape: bool = ...,
        loader: BaseLoader | None = ...,
        cache_size: int = ...,
        auto_reload: bool = ...,
        bytecode_cache: BytecodeCache | None = ...,
    ): ...
    lexer: Any
    def iter_extensions(self): ...
    def getitem(self, obj, argument): ...
    def getattr(self, obj, attribute): ...
    def call_filter(
        self, name, value, args: Any | None = ..., kwargs: Any | None = ..., context: Any | None = ..., eval_ctx: Any | None = ...
    ): ...
    def call_test(self, name, value, args: Any | None = ..., kwargs: Any | None = ...): ...
    def parse(self, source, name: Any | None = ..., filename: Any | None = ...): ...
    def lex(self, source, name: Any | None = ..., filename: Any | None = ...): ...
    def preprocess(self, source: Text, name: Any | None = ..., filename: Any | None = ...): ...
    def compile(self, source, name: Any | None = ..., filename: Any | None = ..., raw: bool = ..., defer_init: bool = ...): ...
    def compile_expression(self, source: Text, undefined_to_none: bool = ...): ...
    def compile_templates(
        self,
        target,
        extensions: Any | None = ...,
        filter_func: Any | None = ...,
        zip: str = ...,
        log_function: Any | None = ...,
        ignore_errors: bool = ...,
        py_compile: bool = ...,
    ): ...
    def list_templates(self, extensions: Any | None = ..., filter_func: Any | None = ...): ...
    def handle_exception(self, exc_info: Any | None = ..., rendered: bool = ..., source_hint: Any | None = ...): ...
    def join_path(self, template: Template | Text, parent: Text) -> Text: ...
    def get_template(self, name: Template | Text, parent: Text | None = ..., globals: Any | None = ...) -> Template: ...
    def select_template(
        self, names: Sequence[Template | Text], parent: Text | None = ..., globals: dict[str, Any] | None = ...
    ) -> Template: ...
    def get_or_select_template(
        self,
        template_name_or_list: Template | Text | Sequence[Template | Text],
        parent: Text | None = ...,
        globals: dict[str, Any] | None = ...,
    ) -> Template: ...
    def from_string(
        self, source: Text, globals: dict[str, Any] | None = ..., template_class: Type[Template] | None = ...
    ) -> Template: ...
    def make_globals(self, d: dict[str, Any] | None) -> dict[str, Any]: ...
    # Frequently added extensions are included here:
    # from InternationalizationExtension:
    def install_gettext_translations(self, translations: Any, newstyle: bool | None = ...): ...
    def install_null_translations(self, newstyle: bool | None = ...): ...
    def install_gettext_callables(
        self, gettext: Callable[..., Any], ngettext: Callable[..., Any], newstyle: bool | None = ...
    ): ...
    def uninstall_gettext_translations(self, translations: Any): ...
    def extract_translations(self, source: Any, gettext_functions: Any): ...
    newstyle_gettext: bool

class Template:
    name: str | None
    filename: str | None
    def __new__(
        cls,
        source,
        block_start_string: Any = ...,
        block_end_string: Any = ...,
        variable_start_string: Any = ...,
        variable_end_string: Any = ...,
        comment_start_string: Any = ...,
        comment_end_string: Any = ...,
        line_statement_prefix: Any = ...,
        line_comment_prefix: Any = ...,
        trim_blocks: Any = ...,
        lstrip_blocks: Any = ...,
        newline_sequence: Any = ...,
        keep_trailing_newline: Any = ...,
        extensions: Any = ...,
        optimized: bool = ...,
        undefined: Any = ...,
        finalize: Any | None = ...,
        autoescape: bool = ...,
    ): ...
    environment: Environment = ...
    @classmethod
    def from_code(cls, environment, code, globals, uptodate: Any | None = ...): ...
    @classmethod
    def from_module_dict(cls, environment, module_dict, globals): ...
    def render(self, *args, **kwargs) -> Text: ...
    def stream(self, *args, **kwargs) -> TemplateStream: ...
    def generate(self, *args, **kwargs) -> Iterator[Text]: ...
    def new_context(
        self, vars: dict[str, Any] | None = ..., shared: bool = ..., locals: dict[str, Any] | None = ...
    ) -> Context: ...
    def make_module(
        self, vars: dict[str, Any] | None = ..., shared: bool = ..., locals: dict[str, Any] | None = ...
    ) -> Context: ...
    @property
    def module(self) -> Any: ...
    def get_corresponding_lineno(self, lineno): ...
    @property
    def is_up_to_date(self) -> bool: ...
    @property
    def debug_info(self): ...
    if sys.version_info >= (3, 6):
        def render_async(self, *args, **kwargs) -> Awaitable[Text]: ...
        def generate_async(self, *args, **kwargs) -> AsyncIterator[Text]: ...

class TemplateModule:
    __name__: Any
    def __init__(self, template, context) -> None: ...
    def __html__(self): ...

class TemplateExpression:
    def __init__(self, template, undefined_to_none) -> None: ...
    def __call__(self, *args, **kwargs): ...

class TemplateStream:
    def __init__(self, gen) -> None: ...
    def dump(self, fp, encoding: Text | None = ..., errors: Text = ...): ...
    buffered: bool
    def disable_buffering(self) -> None: ...
    def enable_buffering(self, size: int = ...) -> None: ...
    def __iter__(self): ...
    def __next__(self): ...
