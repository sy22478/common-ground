# /// script
# requires-python = ">=3.11"
# dependencies = ["pypdf>=5", "cryptography>=42"]
# ///
"""Fetches every page the landing text quotes (lib/sources.json) and looks for the quoted words in it, word for word.

Run it before a submission, and whenever a figure is added:  uv run scripts/check_sources.py

A page that has moved, or whose words have changed, fails here. The figure then comes off the landing page until the
source has been read again. Two of the sources are web pages and one is a PDF; uv fetches what reading a PDF needs.
Exit 0 when every quote is found, 1 otherwise.
"""

import html
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCES = Path(__file__).resolve().parent.parent / "lib" / "sources.json"
BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def plain(text):
    """Spaces, apostrophes and dashes as typed, so a quote is not missed over a kind of space."""
    text = text.replace(" ", " ").replace("’", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text)


def text_of(url):
    request = urllib.request.Request(url, headers={"User-Agent": BROWSER, "Accept": "text/html,application/pdf"})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        kind = response.headers.get("Content-Type", "")
    if "pdf" in kind or body[:5] == b"%PDF-":
        from pypdf import PdfReader

        return plain(" ".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(body)).pages))
    page = body.decode("utf-8", "ignore")
    page = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S | re.I)
    return plain(html.unescape(re.sub(r"<[^>]+>", " ", page)))


def main():
    missing = 0
    for source in json.loads(SOURCES.read_text()):
        try:
            text = text_of(source["url"])
        except Exception as error:  # a page that cannot be fetched is a figure that cannot be shown
            print(f"NOT FETCHED ({type(error).__name__}): {source['url']}")
            missing += 1
            continue
        for words in filter(None, (source.get("asked"), source["quote"])):
            found = plain(words) in text
            missing += not found
            print(f"{'found  ' if found else 'MISSING'} {words[:90]}")
        print(f"        in {source['url'][:110]}")
    print("check_sources: every quote was found on its page" if not missing else f"check_sources: {missing} not found")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
