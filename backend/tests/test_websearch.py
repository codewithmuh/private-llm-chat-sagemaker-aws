"""Web search: SearXNG results, reading pages safely, and search in the chat."""

from __future__ import annotations

import httpx
import pytest

from apps.chat import websearch
from apps.chat.models import Message
from apps.llm.models import LLMModel

from .conftest import Client, parse_sse

SEARXNG = "http://searxng:8080"


@pytest.fixture
def search_on(settings):
    settings.WEB_SEARCH_URL = SEARXNG
    settings.WEB_SEARCH_RESULTS = 3


def searxng_transport(payload: dict, status: int = 200, seen: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, json=payload)

    return httpx.MockTransport(handler)


# ------------------------------------------------------------------ search --


def test_search_reads_searxng_json(search_on):
    seen: list[httpx.Request] = []
    payload = {
        "results": [
            {"title": "Pakistan - Wikipedia", "url": "https://en.wikipedia.org/wiki/Pakistan", "content": "A  country"},
            {"title": "duplicate", "url": "https://en.wikipedia.org/wiki/Pakistan", "content": "x"},
            {"title": "not http", "url": "ftp://example.com/file", "content": "x"},
            {"title": "Gov", "url": "https://www.pakistan.gov.pk/", "content": "Official site"},
            {"title": "Three", "url": "https://example.com/3", "content": ""},
            {"title": "Four (over the limit)", "url": "https://example.com/4", "content": ""},
        ]
    }
    results = websearch.search("prime minister of pakistan", transport=searxng_transport(payload, seen=seen))

    assert [r.url for r in results] == [
        "https://en.wikipedia.org/wiki/Pakistan",
        "https://www.pakistan.gov.pk/",
        "https://example.com/3",
    ]
    assert results[0].snippet == "A country"  # whitespace collapsed
    assert seen[0].url.params["format"] == "json"
    assert seen[0].url.params["q"] == "prime minister of pakistan"
    assert str(seen[0].url).startswith(f"{SEARXNG}/search")


def test_search_errors_are_search_errors(search_on):
    with pytest.raises(websearch.SearchError, match="HTTP 429"):
        websearch.search("x", transport=searxng_transport({}, status=429))

    def unreachable(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(websearch.SearchError, match="could not be reached"):
        websearch.search("x", transport=httpx.MockTransport(unreachable))


# ------------------------------------------------------- reading the pages --


@pytest.mark.parametrize(
    ("url", "public"),
    [
        ("https://8.8.8.8/page", True),
        ("http://127.0.0.1:8000/admin/", False),
        ("http://169.254.169.254/latest/meta-data/", False),  # the AWS metadata service
        ("http://10.0.3.4/", False),
        ("http://[::1]/", False),
        ("ftp://8.8.8.8/file", False),
        ("not a url", False),
    ],
)
def test_only_public_addresses_are_fetched(url, public):
    assert websearch.is_public_url(url) is public


def test_redirects_to_private_addresses_are_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="not a public address"):
            websearch.fetch_text(client, "https://8.8.8.8/start")


def test_page_text_keeps_the_content_and_drops_the_rest():
    html = """
      <html><head><style>body {}</style><script>var tracking = 1;</script></head>
      <body>
        <nav><a href="/">Home</a> <a href="/news">A menu link that is long enough to count</a></nav>
        <h1>Prime Minister of Pakistan</h1>
        <p>The prime minister is the head of government of the Islamic Republic of Pakistan.</p>
        <div>Short</div>
        <footer>Copyright notice that is quite long but in the footer</footer>
      </body></html>
    """
    text = websearch.html_to_text(html)
    assert "head of government" in text
    assert "tracking" not in text and "menu link" not in text and "Copyright" not in text
    assert "Short" not in text  # too short to be content


def test_read_pages_fills_content_and_survives_failures(settings):
    settings.WEB_SEARCH_PAGES = 2

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/ok":
            body = "<p>This page explains the answer in a sentence that is long enough.</p>"
            return httpx.Response(200, text=body, headers={"content-type": "text/html"})
        return httpx.Response(500)

    results = [
        websearch.Result("ok", "https://8.8.8.8/ok", "snippet"),
        websearch.Result("broken", "https://8.8.8.8/broken", "snippet"),
        websearch.Result("not read", "https://8.8.8.8/third", "snippet"),
    ]
    websearch.read_pages(results, transport=httpx.MockTransport(handler))
    assert "explains the answer" in results[0].content
    assert results[1].content == ""  # HTTP 500: skipped, not fatal
    assert results[2].content == ""  # beyond WEB_SEARCH_PAGES


# ---------------------------------------------------------------- the chat --


def fake_search(monkeypatch, *, fail: bool = False) -> list[str]:
    queries: list[str] = []

    def search(query):
        queries.append(query)
        if fail:
            raise websearch.SearchError("The search engine answered with HTTP 503.")
        return [
            websearch.Result("Prime Minister of Pakistan", "https://example.com/pm", "Shehbaz Sharif..."),
            websearch.Result("Cabinet", "https://example.com/cabinet", "The federal cabinet..."),
        ]

    monkeypatch.setattr(websearch, "search", search)
    monkeypatch.setattr(websearch, "read_pages", lambda results: None)
    return queries


def new_conversation(client: Client) -> str:
    return client.post_json("/api/conversations/", {}).json()["id"]


def test_config_says_whether_search_is_available(client: Client, settings):
    settings.WEB_SEARCH_URL = ""
    assert client.get("/api/config/").json()["web_search"] is False
    settings.WEB_SEARCH_URL = SEARXNG
    assert client.get("/api/config/").json()["web_search"] is True


def test_send_with_search(auth_client: Client, mock_model: LLMModel, search_on, monkeypatch):
    queries = fake_search(monkeypatch)
    cid = new_conversation(auth_client)
    events = parse_sse(
        auth_client.post_json(
            f"/api/conversations/{cid}/messages/", {"content": "Who is the prime minister?", "web_search": True}
        )
    )
    names = [e for e, _ in events]
    assert names[:3] == ["start", "search", "sources"]
    assert "done" in names
    assert queries == ["Who is the prime minister?"]  # first message: searched as typed

    sources = dict(events)["sources"]
    assert sources["error"] is None
    assert [s["url"] for s in sources["sources"]] == ["https://example.com/pm", "https://example.com/cabinet"]
    # The mock model reports what it received: the numbered results.
    assert "Web search results: **2**" in dict(events)["done"]["message"]["content"]

    user_message = Message.objects.get(conversation_id=cid, role="user")
    assert user_message.search_query == "Who is the prime minister?"
    assert user_message.sources[0]["title"] == "Prime Minister of Pakistan"
    detail = auth_client.get(f"/api/conversations/{cid}/").json()
    assert detail["messages"][0]["sources"][0]["url"] == "https://example.com/pm"
    assert "content" not in detail["messages"][0]["sources"][0]  # page text stays server-side

    # A follow-up without Search still sees the earlier results...
    events = parse_sse(auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "And before him?"}))
    assert "search" not in [e for e, _ in events]
    # ...and with Search, the model rewrites the follow-up into a full query.
    parse_sse(
        auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "His party?", "web_search": True})
    )
    assert len(queries) == 2 and queries[1]


def test_search_results_are_in_the_prompt(auth_client: Client, user, mock_model: LLMModel, search_on, monkeypatch):
    from apps.chat.models import Conversation
    from apps.chat.prompting import SEARCH_INSTRUCTIONS, build_prompt

    fake_search(monkeypatch)
    cid = new_conversation(auth_client)
    parse_sse(auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "PM?", "web_search": True}))
    prompt = build_prompt(Conversation.objects.get(pk=cid), mock_model, user)

    assert SEARCH_INSTRUCTIONS in prompt.messages[0]["content"]
    user_turn = prompt.messages[1]["content"]
    assert '<search_results query="PM?"' in user_turn
    assert "[1] Prime Minister of Pakistan\nhttps://example.com/pm\nShehbaz Sharif..." in user_turn
    assert user_turn.rstrip().endswith("PM?")


def test_a_failed_search_still_answers(auth_client: Client, mock_model: LLMModel, search_on, monkeypatch):
    fake_search(monkeypatch, fail=True)
    cid = new_conversation(auth_client)
    events = parse_sse(
        auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "News?", "web_search": True})
    )
    assert "HTTP 503" in dict(events)["sources"]["error"]
    assert dict(events)["done"]["message"]["status"] == "complete"


def test_search_needs_a_configured_engine(auth_client: Client, mock_model: LLMModel, settings):
    settings.WEB_SEARCH_URL = ""
    cid = new_conversation(auth_client)
    res = auth_client.post_json(f"/api/conversations/{cid}/messages/", {"content": "News?", "web_search": True})
    assert res.status_code == 400
    assert "WEB_SEARCH_URL" in res.json()["error"]
