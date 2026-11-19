# This sample tests datetime subclass preservation and conservative timezone inference.

from datetime import date, datetime, time, timezone


class CustomDateTime(datetime):
    def custom(self) -> int:
        return 1


constructed = CustomDateTime(2026, 1, 1)
reveal_type(constructed, expected_text="CustomDateTime")
reveal_type(constructed.custom(), expected_text="int")

aware = CustomDateTime(2026, 1, 1, tzinfo=timezone.utc)
reveal_type(aware, expected_text="CustomDateTime")
reveal_type(aware.custom(), expected_text="int")

positional = CustomDateTime(2026, 1, 1, 0, 0, 0, 0, timezone.utc)
reveal_type(positional, expected_text="CustomDateTime")
reveal_type(positional.custom(), expected_text="int")

now = CustomDateTime.now()
reveal_type(now, expected_text="CustomDateTime")
reveal_type(now.custom(), expected_text="int")

aware_now = CustomDateTime.now(timezone.utc)
reveal_type(aware_now, expected_text="CustomDateTime")
reveal_type(aware_now.custom(), expected_text="int")

reveal_type(CustomDateTime.now(None), expected_text="CustomDateTime")
reveal_type(CustomDateTime.today(), expected_text="CustomDateTime")
reveal_type(CustomDateTime.fromtimestamp(0), expected_text="CustomDateTime")
reveal_type(CustomDateTime.fromtimestamp(0, timezone.utc), expected_text="CustomDateTime")
reveal_type(CustomDateTime.fromisoformat("2026-01-01"), expected_text="CustomDateTime")
reveal_type(aware.replace(tzinfo=None), expected_text="CustomDateTime")
reveal_type(aware.astimezone(timezone.utc), expected_text="CustomDateTime")

day = date(2026, 1, 1)
clock = time(12, tzinfo=timezone.utc)

# Omitting tzinfo preserves clock.tzinfo; an explicit None clears it.
inherited = datetime.combine(day, clock)
reveal_type(inherited, expected_text="datetime")
reveal_type(inherited.tzinfo, expected_text="tzinfo | None")

cleared = datetime.combine(day, clock, tzinfo=None)
reveal_type(cleared, expected_text="datetime")
reveal_type(cleared.tzinfo, expected_text="tzinfo | None")
reveal_type(datetime.combine(day, clock, None).tzinfo, expected_text="tzinfo | None")
reveal_type(datetime.combine(day, clock, timezone.utc).tzinfo, expected_text="tzinfo | None")
reveal_type(datetime.combine(day, time(12)).tzinfo, expected_text="tzinfo | None")

combined_subclass = CustomDateTime.combine(day, clock)
reveal_type(combined_subclass, expected_text="CustomDateTime")
reveal_type(combined_subclass.custom(), expected_text="int")

if inherited.tzinfo is not None:
    reveal_type(inherited.tzinfo.utcoffset(None), expected_text="timedelta | None")

# This should generate an error because tzinfo must be a timezone or None.
datetime.combine(day, clock, tzinfo=1)

# This should generate an error because tzinfo must be a timezone or None.
CustomDateTime(2026, 1, 1, tzinfo=1)
