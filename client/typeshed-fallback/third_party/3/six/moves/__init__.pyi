# Stubs for six.moves
#
# Note: Commented out items means they weren't implemented at the time.
# Uncomment them when the modules have been added to the typeshed.
import sys
from builtins import filter as filter, input as input, map as map, range as xrange, zip as zip
from collections import UserDict as UserDict, UserList as UserList, UserString as UserString
from functools import reduce as reduce
from importlib import reload as reload_module
from io import StringIO as StringIO
from itertools import filterfalse as filterfalse, zip_longest as zip_longest
from os import getcwd as getcwd, getcwdb as getcwdb
from shlex import quote as shlex_quote
from sys import intern as intern

# import tkinter.font as tkinter_font
# import tkinter.messagebox as tkinter_messagebox
# import tkinter.simpledialog as tkinter_tksimpledialog
# import tkinter.dnd as tkinter_dnd
# import tkinter.colorchooser as tkinter_colorchooser
# import tkinter.scrolledtext as tkinter_scrolledtext
# import tkinter.simpledialog as tkinter_simpledialog
# import tkinter.tix as tkinter_tix
# import copyreg as copyreg
# import dbm.gnu as dbm_gnu
from . import (
    BaseHTTPServer,
    CGIHTTPServer,
    SimpleHTTPServer,
    _dummy_thread,
    _thread,
    builtins,
    configparser,
    cPickle,
    email_mime_base,
    email_mime_multipart,
    email_mime_nonmultipart,
    email_mime_text,
    html_entities,
    html_parser,
    http_client,
    http_cookiejar,
    http_cookies,
    queue,
    reprlib,
    socketserver,
    tkinter,
    tkinter_commondialog,
    tkinter_constants,
    tkinter_dialog,
    tkinter_filedialog,
    tkinter_tkfiledialog,
    tkinter_ttk,
    urllib,
    urllib_error,
    urllib_parse,
    urllib_robotparser,
)

# import xmlrpc.client as xmlrpc_client
# import xmlrpc.server as xmlrpc_server
