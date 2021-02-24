from _typeshed.wsgi import ErrorStream
from logging import Handler, Logger

from .app import Flask

wsgi_errors_stream: ErrorStream

def has_level_handler(logger: Logger) -> bool: ...

default_handler: Handler

def create_logger(app: Flask) -> Logger: ...
