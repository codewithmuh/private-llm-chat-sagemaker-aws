"""Web search: fresh facts for a model whose knowledge stops at its training date.

A model only knows what it read during training. Ask "who is the prime
minister now?" and it can only guess from old data. ChatGPT solves this with a
search tool, and this is the same idea in its simplest form (often called
retrieval-augmented generation, RAG):

  1. Turn the question into a search query. A follow-up like "and its
     population?" means nothing on its own, so the model rewrites it using the
     conversation.
  2. Ask a search engine: SearXNG (search/ in this repo), an open-source
     metasearch engine that runs next to the api (docker-compose.yml locally,
     a sidecar container on AWS). It asks Google, Bing, DuckDuckGo,
     Wikipedia... for us and needs no API key.
  3. Open the top pages and keep their main text: a search snippet is one
     sentence, often too little to answer from.
  4. Put the numbered results into the prompt (apps/chat/prompting.py). The
     model answers from them and cites [1], [2]; the UI lists the sources.

The user decides when to search (the "Search" button): small models are not
reliable at deciding by themselves, and every search adds a few seconds.

Opening pages on behalf of users is a classic SSRF risk: a result could point
at http://169.254.169.254/ (the AWS metadata service) or at another container.
So only http(s) addresses that resolve to public IPs are fetched.
"""

from __future__ import annotations

import contextlib
import ipaddress
import logging
import re
import socket
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from django.conf import settings

from apps.llm.models import LLMModel
from apps.llm.providers import ChatRequest, ProviderError, provider_for

from .models import Conversation, Message

log = logging.getLogger(__name__)

# Characters kept from each page: enough for the facts, small enough that five
# results fit in an 8k-token context window next to the conversation.
PAGE_CHARS = 2500
MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
USER_AGENT = (
    "Mozilla/5.0 (compatible; PrivateLLMChat/1.0; +https://github.com/codewithmuh/private-llm-chat-sagemaker-aws)"
)

QUERY_PROMPT = (
    "Write the web search query that would find the answer to the user's last message. "
    "Use the conversation to fill in what the message refers to. Reply with the query only, "
    "at most 12 words, no quotes.\n\n<conversation>\n{conversation}\n</conversation>"
)


class SearchError(Exception):
    """The search engine could not be reached or answered with an error."""


@dataclass
class Result:
    title: str
    url: str
    snippet: str
    content: str = ""  # the page's main text, when we could read it

    def public(self) -> dict:
        """What the API and the UI get (the page text stays server-side)."""
        return {"title": self.title, "url": self.url, "snippet": self.snippet}

    def stored(self) -> dict:
        return {**self.public(), "content": self.content}


def enabled() -> bool:
    return bool(settings.WEB_SEARCH_URL)


# ----------------------------------------------------------------- query ---


def search_query(conversation: Conversation, user_message: Message, model: LLMModel) -> str:
    """The query to search for. Follow-ups are rewritten by the model."""
    question = user_message.content.strip()
    earlier = list(
        conversation.messages.filter(created_at__lt=user_message.created_at)
        .exclude(status=Message.Status.ERROR)
        .order_by("-created_at")[:4]
    )
    if not earlier:
        return question[:300]
    lines = [f"{m.role}: {m.content.strip()[:500]}" for m in reversed(earlier)] + [f"user: {question[:500]}"]
    request = ChatRequest(
        messages=[{"role": "user", "content": QUERY_PROMPT.format(conversation="\n".join(lines))}],
        max_tokens=40,
        temperature=0.0,
    )
    try:
        text = provider_for(model).complete(request).text
    except ProviderError:
        return question[:300]
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    query = text.splitlines()[0].strip().strip("\"'`") if text else ""
    return query[:300] or question[:300]


# ---------------------------------------------------------------- search ---


def search(query: str, *, transport: httpx.BaseTransport | None = None) -> list[Result]:
    """Ask SearXNG (its JSON API) and return the top results."""
    try:
        with httpx.Client(timeout=settings.WEB_SEARCH_TIMEOUT_SECONDS, transport=transport) as client:
            response = client.get(
                f"{settings.WEB_SEARCH_URL}/search",
                params={"q": query, "format": "json", "safesearch": 1},
            )
    except httpx.HTTPError as exc:
        raise SearchError(f"The search engine could not be reached ({type(exc).__name__}).") from None
    if response.status_code != 200:
        raise SearchError(f"The search engine answered with HTTP {response.status_code}.")
    try:
        items = response.json().get("results", [])
    except ValueError:
        raise SearchError("The search engine did not answer with JSON.") from None

    results: list[Result] = []
    seen: set[str] = set()
    for item in items:
        url = str(item.get("url") or "")
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        seen.add(url)
        results.append(
            Result(
                title=_clean(str(item.get("title") or url))[:200],
                url=url,
                snippet=_clean(str(item.get("content") or ""))[:500],
            )
        )
        if len(results) >= settings.WEB_SEARCH_RESULTS:
            break
    return results


def read_pages(results: list[Result], *, transport: httpx.BaseTransport | None = None) -> None:
    """Fill in `content` for the first WEB_SEARCH_PAGES results, in parallel."""
    targets = results[: settings.WEB_SEARCH_PAGES]
    if not targets:
        return
    with httpx.Client(
        timeout=settings.WEB_SEARCH_TIMEOUT_SECONDS,
        transport=transport,
        follow_redirects=False,  # each redirect is checked by fetch_text
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain;q=0.9"},
    ) as client:
        with ThreadPoolExecutor(max_workers=len(targets)) as pool:
            texts = list(pool.map(lambda r: _fetch_text_quietly(client, r.url), targets))
    for result, text in zip(targets, texts, strict=True):
        result.content = text


def _fetch_text_quietly(client: httpx.Client, url: str) -> str:
    try:
        return fetch_text(client, url)
    except Exception as exc:  # noqa: BLE001 - one unreadable page must not fail the search
        log.info("web page not read", extra={"url": url, "reason": type(exc).__name__})
        return ""


def fetch_text(client: httpx.Client, url: str) -> str:
    """The main text of a public web page (first PAGE_CHARS characters)."""
    for _ in range(MAX_REDIRECTS + 1):
        if not is_public_url(url):
            raise ValueError("not a public address")
        with client.stream("GET", url) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get("location", ""))
                continue
            response.raise_for_status()
            ctype = response.headers.get("content-type", "")
            if "html" not in ctype and "text/plain" not in ctype:
                return ""
            body = b""
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) > MAX_PAGE_BYTES:
                    break
            text = body.decode(response.encoding or "utf-8", errors="replace")
            return (html_to_text(text) if "html" in ctype else _clean(text))[:PAGE_CHARS]
    raise ValueError("too many redirects")


def is_public_url(url: str) -> bool:
    """http(s) only, and every address the host resolves to must be public."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, ValueError):
        return False
    addresses = {info[4][0] for info in infos}
    return bool(addresses) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses)


# ------------------------------------------------------------- page text ---


class _TextExtractor(HTMLParser):
    """Visible text of the page's content, without menus, scripts and footers."""

    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "iframe", "template"}
    BLOCK = {"p", "div", "li", "br", "tr", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skipping = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skipping:
            self.skipping -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    with contextlib.suppress(Exception):  # broken HTML: keep what was parsed
        parser.feed(html)
        parser.close()
    lines = (_clean(line) for line in "".join(parser.parts).splitlines())
    # Very short lines are mostly leftovers of menus and buttons.
    return "\n".join(line for line in lines if len(line) >= 25)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------- prompt ---


def results_block(query: str, results: list[dict]) -> str:
    """The numbered results as the model reads them (see prompting.py)."""
    if not results:
        return f"Searched the web for: {query}\nNo results were found."
    parts = [f"Searched the web for: {query}"]
    for number, result in enumerate(results, start=1):
        body = result.get("content") or result.get("snippet") or ""
        parts.append(f"[{number}] {result['title']}\n{result['url']}\n{body}".strip())
    return "\n\n".join(parts)
