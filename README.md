# @pipeworx/china-news

Search recent news coverage from 28 Chinese, Hong Kong, Taiwanese and
overseas-Chinese publishers — headline, publisher, URL, publication time,
theme tags and average article tone — sourced from the GDELT Project's Global
Knowledge Graph.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1576+ live data sources.

## Tools

- `china_news_search({query?, region?, outlets?, lang?, since?, until?, limit?})`
  — how a topic is being covered across mainland, Hong Kong, Taiwanese and
  diaspora outlets. Free text is matched against the headline, the article URL
  and GDELT's theme tags.
- `china_news_article({url})` — everything known about one indexed article:
  publisher, headline, time, themes, tone, mentioned places. Says in words that
  no article text is available rather than returning an empty `body`.
- `china_news_outlets({region?, method?, searchable_only?})` — the audited
  census of 106 publishers, each flagged `searchable: true|false`, with the
  timestamp of its most recent indexed article. This is the tool that makes
  coverage checkable instead of assumed.

## Auth

Keyless. No caller credential of any kind.

## Data sources

- <http://data.gdeltproject.org/gdeltv2/> — the GDELT Global Knowledge Graph
  bulk feed, published every 15 minutes, filtered to the China/HK/TW publisher
  set. GDELT's terms permit commercial reuse.
- `docs/data/china-news-inventory.json` in the Pipeworx monorepo — the
  hand-audited publisher census behind `china_news_outlets` (fleet #1390).

## Things the next person would otherwise rediscover

- **GDELT has no article text, for any publisher, ever.** The Global Knowledge
  Graph is an index of articles, not a copy of them. `china_news_article`
  returns `body_available: false` with a named reason; do not add a `body`
  field that is sometimes an empty string.
- **`region` is not `lang`.** The census `region` is the publisher's
  jurisdiction. A Chinese-language query answered with Taiwanese coverage is
  the single most common mistake in this domain — `docs/china-news-plan.md`
  sec 9 records it being made with GDELT's own `sourcelang:` parameter.
- **`lang` is read from the SERVING HOST, not from the publisher's home
  edition.** Measured 2026-09-11: every host then present in the index was an
  English one, and four of them (`english.news.cn`, `en.people.cn`,
  `en.gmw.cn`, `en.ce.cn`) belong to publishers the census records as `zh` —
  GDELT indexes the mainland state outlets' English editions far more heavily
  than their Chinese ones. Filtering on the publisher's language would have
  answered `lang: "zh"` with English articles.
- **Coverage is genuinely sparse, and that is not a bug.** Per 15-minute file,
  0-20 rows match the publisher set, and consecutive files often match none of
  them — many of these outlets publish a handful of times a day. An empty
  search result is therefore normal; `china_news_search` answers one by naming
  the filters it applied and listing the publishers that *do* currently have
  articles, so it can be told apart from a broken tool.
- **Headlines arrive HTML-entity-encoded, and that cuts both ways.** GDELT's
  `PAGE_TITLE` renders every non-ASCII character as a numeric character
  reference, so a Chinese headline is stored as
  `&#x8449;&#x9580;&#x53DB;&#x8ECD;…`. Two consequences, both handled here:
  titles are decoded on read (so the current 30-day window is fixed, not just
  future rows), and a free-text query containing non-ASCII characters is
  searched in BOTH spellings — a literal CJK query matches nothing against the
  stored text, however many rows are there.
- **Publisher domains arrive as subdomains.** GDELT records the serving host
  (`english.news.cn`), never the census home domain (`news.cn`). Every domain
  filter here matches exact-or-dot-suffix — never substring, or
  `theepochtimes.com` would match `epochtimes.com`, a different publisher.
- **Some headlines are genuinely absent.** China Daily's GKG rows carry a
  site-wide tagline instead of the article headline, so it is stored as absent;
  a row can have `title: null` and a `title_unavailable` note. That is why the
  free-text search also matches the URL slug and the theme tags — a
  headline-only search could never reach those rows.
- **The DOC API is not an alternative backend.** `api.gdeltproject.org` never
  cleared 50% success across three measurement sessions at any request spacing
  (`docs/china-news-plan.md` sec 8a).

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "china-news": {
      "url": "https://gateway.pipeworx.io/china-news/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/china-news/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1576+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "china-news": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-china-news"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-china-news
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about China News data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
