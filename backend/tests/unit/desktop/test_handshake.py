"""015 T007: the stdin handshake and the identity proof (research R5)."""

from __future__ import annotations

import hashlib
import hmac
import io
import json

import pytest

from unihelper.desktop import handshake

pytestmark = pytest.mark.unit

TOKEN = "0123456789abcdef" * 4
SECRET = "fedcba9876543210" * 4


def _line(**values: object) -> str:
    return json.dumps(values) + "\n"


def test_valid_line_parses_and_leaves_the_rest_of_the_stream() -> None:
    stream = io.StringIO(_line(launchToken=TOKEN, clientSecret=SECRET) + "more")
    hs = handshake.read_handshake(stream)
    assert hs.launch_token == TOKEN and hs.client_secret == SECRET
    assert stream.read() == "more"


@pytest.mark.parametrize(
    "line",
    [
        "",
        "not json\n",
        "[]\n",
        _line(launchToken=TOKEN),
        _line(launchToken=TOKEN, clientSecret=SECRET, extra="x"),
        _line(launchToken=TOKEN[:-2], clientSecret=SECRET),
        _line(launchToken=TOKEN.upper(), clientSecret=SECRET),
        _line(launchToken=TOKEN, clientSecret="z" * 64),
        _line(launchToken=1, clientSecret=SECRET),
    ],
)
def test_bad_lines_are_refused(line: str) -> None:
    with pytest.raises(handshake.HandshakeError):
        handshake.read_handshake(io.StringIO(line))


def test_proof_is_hmac_of_the_nonce_with_the_token() -> None:
    hs = handshake.Handshake(TOKEN, SECRET)
    nonce = "ab" * 16
    expected = hmac.new(bytes.fromhex(TOKEN), bytes.fromhex(nonce), hashlib.sha256).hexdigest()
    assert hs.proof(nonce) == expected


@pytest.mark.parametrize("nonce", ["", "ab" * 15, "ab" * 65, "zz" * 16, "abc" * 11])
def test_nonce_length_and_alphabet_are_checked(nonce: str) -> None:
    with pytest.raises(handshake.HandshakeError):
        handshake.Handshake(TOKEN, SECRET).proof(nonce)


def test_client_and_bearer_checks() -> None:
    hs = handshake.Handshake(TOKEN, SECRET)
    assert hs.check_client(SECRET) and not hs.check_client(None) and not hs.check_client("x")
    assert hs.check_bearer(f"Bearer {TOKEN}")
    assert (
        not hs.check_bearer(TOKEN) and not hs.check_bearer("Bearer x") and not hs.check_bearer(None)
    )


def test_secrets_never_show_in_repr_or_str() -> None:
    hs = handshake.Handshake(TOKEN, SECRET)
    for text in (repr(hs), str(hs), f"{hs}"):
        assert TOKEN not in text and SECRET not in text
