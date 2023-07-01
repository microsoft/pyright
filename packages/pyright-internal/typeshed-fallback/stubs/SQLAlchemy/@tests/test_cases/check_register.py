from __future__ import annotations

from _typeshed.dbapi import DBAPIConnection
from typing import cast

from sqlalchemy.engine.base import Engine
from sqlalchemy.engine.default import DefaultDialect
from sqlalchemy.engine.url import URL
from sqlalchemy.pool.base import Pool
from sqlalchemy.testing import config as ConfigModule
from sqlalchemy.testing.provision import (
    configure_follower,
    create_db,
    drop_all_schema_objects_post_tables,
    drop_all_schema_objects_pre_tables,
    drop_db,
    follower_url_from_main,
    generate_driver_url,
    get_temp_table_name,
    post_configure_engine,
    prepare_for_drop_tables,
    register,
    run_reap_dbs,
    set_default_schema_on_connection,
    stop_test_class_outside_fixtures,
    temp_table_keyword_args,
    update_db_opts,
)
from sqlalchemy.util import immutabledict

url = URL("", "", "", "", 0, "", immutabledict())
engine = Engine(Pool(lambda: cast(DBAPIConnection, object())), DefaultDialect(), "")
config = cast(ConfigModule.Config, object())
unused = None


class Foo:
    pass


# Test that the decorator changes the first parameter to "cfg: str | URL | _ConfigProtocol"
@register.init
def no_args(__foo: Foo) -> None:
    pass


no_args(cfg="")
no_args(cfg=url)
no_args(cfg=config)

# Test pre-decorated functions
generate_driver_url(url, "", "")
drop_all_schema_objects_pre_tables(url, unused)
drop_all_schema_objects_post_tables(url, unused)
create_db(url, engine, unused)
drop_db(url, engine, unused)
update_db_opts(url, unused)
post_configure_engine(url, unused, unused)
follower_url_from_main(url, "")
configure_follower(url, unused)
run_reap_dbs(url, unused)
temp_table_keyword_args(url, engine)
prepare_for_drop_tables(url, unused)
stop_test_class_outside_fixtures(url, unused, type)
get_temp_table_name(url, unused, "")
set_default_schema_on_connection(url, unused, unused)
set_default_schema_on_connection(ConfigModule, unused, unused)
set_default_schema_on_connection(config, unused, unused)
