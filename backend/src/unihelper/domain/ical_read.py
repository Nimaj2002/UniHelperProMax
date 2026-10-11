"""Reading an iCalendar (.ics) file into plain values (010 research R1, R3, R8).

Pure — no database or file access. `read_calendar` checks the bytes and returns one `RawEvent`
per `VEVENT` with its text cleaned and its links extracted; time zones and repetition are mapped
to the app's model by `domain/ical_rules.py`. Text is only ever treated as plain text.
"""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from icalendar import Calendar

MAX_EVENTS = 5000
MAX_LINKS = 10
MAX_URL = 2048
MAX_LABEL = 60

Link = tuple[str | None, str]


class IcsError(ValueError):
    """The file can't be imported at all; `code` is the API problem code (research R3)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class RawEvent:
    uid: str
    summary: str
    location: str
    links: list[Link]
    dtstart: date | datetime | None
    dtend: date | datetime | None
    duration: timedelta | None
    rrules: list[dict[str, list[Any]]]
    exrule: bool
    rdates: list[date | datetime]
    exdates: list[date | datetime]
    recurrence_id: date | datetime | None
    status: str
    x_props: dict[str, str]
    notes: list[str] = field(default_factory=list)
    rdate_durations: dict[date | datetime, timedelta] = field(default_factory=dict)


@dataclass
class ParsedCalendar:
    calendar_tz: str | None
    prodid: str
    events: list[RawEvent]


# ---- text and links ------------------------------------------------------------------------

_WS = re.compile(r"\s+")
_URL = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)
_HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
_TAG = re.compile(r"<[^>]*>")
_TRAILING = ".,;:!?)]}>'\""
_LABELLED = re.compile(r"^\s*([^:\n]{1,60}?):\s+(https?://\S+)\s*$", re.IGNORECASE)
# Google's automatic block: "-::~:~::~:~:~…~::~:~::-" delimiter lines around the join details
_GOOGLE_DELIM = re.compile(r"^-::~[:~]*::-?\s*$")
_GOOGLE_LINES = re.compile(
    r"^\s*(Join with Google Meet|Join by phone|Join using SIP|More phone numbers|"
    r"Learn more about Meet|Please do not edit this section)\b",
    re.IGNORECASE,
)


def clean_text(value: object) -> str:
    """One line of plain text: whitespace (incl. newlines) collapsed, ends trimmed."""
    if value is None:
        return ""
    return _WS.sub(" ", str(value)).strip()


def valid_url(url: str) -> bool:
    """The same rule as manual links (`schemas.classes.Link`): http(s) with a host."""
    if len(url) > MAX_URL:
        return False
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme.lower() in ("http", "https") and bool(parsed.netloc)


def strip_google_block(text: str) -> str:
    """Remove Google Calendar's automatic "join this meeting" section from a description."""
    out: list[str] = []
    inside = False
    for line in text.splitlines():
        if _GOOGLE_DELIM.match(line.strip()):
            inside = not inside
            continue
        if inside or _GOOGLE_LINES.match(line):
            continue
        out.append(line)
    return "\n".join(out)


def description_links(text: str) -> list[Link]:
    """http(s) addresses in a description: anchors' hrefs first, then addresses in the text. A
    line "Label: address" (as this app's export writes) gives the address its label. Markup is
    never interpreted — tags are only dropped before scanning."""
    text = strip_google_block(text)
    found: list[Link] = [(None, html.unescape(h)) for h in _HREF.findall(text)]
    plain = html.unescape(_TAG.sub(" ", text))
    for line in plain.splitlines():
        labelled = _LABELLED.match(line)
        if labelled:
            found.append((_label(labelled.group(1)), labelled.group(2).rstrip(_TRAILING)))
            continue
        found += [(None, m.group(0).rstrip(_TRAILING)) for m in _URL.finditer(line)]
    return found


def description_urls(text: str) -> list[str]:
    return [url for _label_, url in description_links(text)]


def _label(value: object) -> str | None:
    text = clean_text(value)
    return text[:MAX_LABEL] or None


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def extract_links(component: Any) -> tuple[list[Link], list[str]]:
    """Links in order: URL, meeting links, attachments, then description addresses (R8).
    Only valid http(s) addresses are kept, each once, at most ten."""
    candidates: list[Link] = []
    for url in _as_list(component.get("URL")):
        candidates.append((None, str(url).strip()))
    for url in _as_list(component.get("X-GOOGLE-CONFERENCE")):
        candidates.append(("Google Meet", str(url).strip()))
    for conf in _as_list(component.get("CONFERENCE")):
        params = getattr(conf, "params", {})
        candidates.append((_label(params.get("LABEL")) or "Meeting", str(conf).strip()))
    for att in _as_list(component.get("ATTACH")):
        params = getattr(att, "params", {})
        if str(params.get("VALUE", "")).upper() == "BINARY":
            continue
        name = params.get("FILENAME") or params.get("X-FILENAME")
        candidates.append((_label(name), str(att).strip()))
    for desc in _as_list(component.get("DESCRIPTION")):
        candidates += description_links(str(desc))

    links: list[Link] = []
    seen: dict[str, int] = {}
    dropped = 0
    for label, url in candidates:
        if not valid_url(url):
            dropped += 1
            continue
        if url in seen:  # the same address again: keep the first place, take a label it lacked
            i = seen[url]
            if links[i][0] is None and label is not None:
                links[i] = (label, url)
            continue
        seen[url] = len(links)
        links.append((label, url))
    notes: list[str] = []
    if dropped:
        notes.append(
            f"{dropped} link{'s' if dropped != 1 else ''} that "
            f"{'are' if dropped != 1 else 'is'} not a web address (http or https) left out."
        )
    if len(links) > MAX_LINKS:
        notes.append(f"Only the first {MAX_LINKS} of {len(links)} links kept.")
        links = links[:MAX_LINKS]
    return links, notes


# ---- values -------------------------------------------------------------------------------


def _first(component: Any, name: str) -> Any:
    value = component.get(name)
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _dt(component: Any, name: str) -> date | datetime | None:
    prop = _first(component, name)
    if prop is None:
        return None
    value = getattr(prop, "dt", None)
    if isinstance(value, (date, datetime)):
        return value
    return None


def _dates(component: Any, name: str) -> list[date | datetime]:
    out: list[date | datetime] = []
    for prop in _as_list(component.get(name)):
        for item in getattr(prop, "dts", []):
            value = item.dt
            if isinstance(value, tuple):  # RDATE;VALUE=PERIOD → its start (end ignored)
                value = value[0]
            if isinstance(value, (date, datetime)):
                out.append(value)
    return out


def _period_durations(component: Any) -> dict[date | datetime, timedelta]:
    """RDATE;VALUE=PERIOD entries carry their own length."""
    out: dict[date | datetime, timedelta] = {}
    for prop in _as_list(component.get("RDATE")):
        for item in getattr(prop, "dts", []):
            value = item.dt
            if isinstance(value, tuple) and len(value) == 2:
                start, end = value
                out[start] = end if isinstance(end, timedelta) else end - start
    return out


def _uid(component: Any) -> str:
    raw = _first(component, "UID")
    uid = clean_text(raw)
    if uid:
        return uid[:1024]
    return "nouid-" + hashlib.sha1(component.to_ical()).hexdigest()


def _raw_event(component: Any) -> RawEvent:
    links, notes = extract_links(component)
    rrules = [dict(r) for r in _as_list(component.get("RRULE"))]
    duration_prop = _first(component, "DURATION")
    duration = getattr(duration_prop, "dt", None) if duration_prop is not None else None
    x_props = {
        str(k).upper(): clean_text(v)
        for k, v in component.property_items(recursive=False)
        if str(k).upper().startswith("X-UNIHELPER-")
    }
    raw = RawEvent(
        uid=_uid(component),
        summary=clean_text(_first(component, "SUMMARY")),
        location=clean_text(_first(component, "LOCATION")),
        links=links,
        dtstart=_dt(component, "DTSTART"),
        dtend=_dt(component, "DTEND"),
        duration=duration if isinstance(duration, timedelta) else None,
        rrules=rrules,
        exrule=component.get("EXRULE") is not None,
        rdates=_dates(component, "RDATE"),
        exdates=_dates(component, "EXDATE"),
        recurrence_id=_dt(component, "RECURRENCE-ID"),
        status=clean_text(_first(component, "STATUS")).upper(),
        x_props=x_props,
        notes=notes,
        rdate_durations=_period_durations(component),
    )
    return raw


def read_calendar(data: bytes) -> ParsedCalendar:
    """Check and parse a whole file. Raises `IcsError` when it can't be imported at all."""
    if not data.strip():
        raise IcsError("file_empty", "This file is empty.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as err:
        raise IcsError("not_icalendar", "This isn't a valid calendar (.ics) file.") from err
    if "BEGIN:VCALENDAR" not in text.upper():
        raise IcsError("not_icalendar", "This isn't a valid calendar (.ics) file.")
    if text.upper().count("BEGIN:VEVENT") > MAX_EVENTS:
        raise IcsError("too_many_events", "This file has more than 5,000 events.")
    try:
        calendars = Calendar.from_ical(text, multiple=True)
    except Exception as err:  # the parser raises many kinds on malformed input
        raise IcsError("not_icalendar", "This isn't a valid calendar (.ics) file.") from err
    if not calendars:
        raise IcsError("not_icalendar", "This isn't a valid calendar (.ics) file.")
    events: list[RawEvent] = []
    calendar_tz: str | None = None
    prodid = ""
    try:
        for cal in calendars:
            if cal.name != "VCALENDAR":
                raise IcsError("not_icalendar", "This isn't a valid calendar (.ics) file.")
            calendar_tz = calendar_tz or (clean_text(cal.get("X-WR-TIMEZONE")) or None)
            prodid = prodid or clean_text(cal.get("PRODID"))
            events += [_raw_event(c) for c in cal.walk("VEVENT")]
    except IcsError:
        raise
    except Exception as err:
        raise IcsError("not_icalendar", "This isn't a valid calendar (.ics) file.") from err
    if len(events) > MAX_EVENTS:
        raise IcsError("too_many_events", "This file has more than 5,000 events.")
    return ParsedCalendar(calendar_tz=calendar_tz, prodid=prodid, events=events)
