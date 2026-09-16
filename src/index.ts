interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities$shared(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities$shared(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}
/**
 * China / Hong Kong / Taiwan news search.
 *
 * WHAT THIS RETURNS: article-level metadata — publisher, headline, URL,
 * publication time, GDELT's themes and average article tone — for 28 Chinese,
 * Hong Kong, Taiwanese and overseas-Chinese publishers, sourced from the
 * GDELT Project's Global Knowledge Graph (data.gdeltproject.org), which
 * indexes world news every 15 minutes.
 *
 * WHAT IT DOES NOT RETURN: article bodies. GDELT is a metadata index — it
 * never carries the text of the article, only the link to it. `china_news_article`
 * says so in those words rather than handing back an empty `body` field; see
 * docs/silent-zero-policy.md for why an honest refusal is worth more here than
 * a clean-looking empty success.
 *
 * WHY GDELT AND NOT THE PUBLISHERS DIRECTLY: measured in
 * docs/china-news-plan.md sec 4a/5 — most mainland publishers have no working
 * feed (China Daily's six candidate RSS paths all 404; People's Daily's feed
 * parses but its newest item is 15 months old) and none are reachable from
 * this platform's egress. GDELT indexes them all anyway.
 *
 * WHY THE BULK GKG FEED AND NOT GDELT'S DOC API: three independent measurement
 * sessions (2026-09-08, -10, -11) never cleared 50% success against
 * api.gdeltproject.org at any request spacing, throttled by a burst-triggered
 * per-IP cooldown (docs/china-news-plan.md sec 8a). A search tool cannot be
 * built on a surface that refuses half its calls.
 *
 * The pack is stateless — the gateway owns auth and rate limiting — and never
 * throws for an expected empty result: it says which filters it applied and
 * what coverage actually exists, so "no articles matched" can be told apart
 * from "this tool is broken".
 */

import { OUTLETS, INDEXED_OUTLETS, REGIONS, langOf, outletForHost, type Outlet, type Region } from './outlets.js';

interface DataConfig {
  url: string;
  key: string;
}

const TABLE = 'china_news_gkg';
const RETENTION_DAYS = 30;

async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'China news index');
}

async function pg<T>(cfg: DataConfig, query: string): Promise<T> {
  const res = await pwFetch(`${cfg.url}/rest/v1/${TABLE}?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) throw await httpError(res, 'China news index');
  return res.json() as Promise<T>;
}

interface GkgRow {
  gkg_record_id: string;
  published_at: string;
  source_domain: string;
  url: string;
  title: string | null;
  tone_avg: number | string | null;
  themes: string | null;
  locations: string | null;
}

const SELECT =
  'select=gkg_record_id,published_at,source_domain,url,title,tone_avg,themes,locations';

/**
 * GDELT's PAGE_TITLE carries every non-ASCII character as a numeric character
 * reference, so a Chinese headline arrives as
 * `&#x8449;&#x9580;&#x53DB;&#x8ECD;…` and is unreadable as it stands — caught
 * live 2026-09-11 on the CNA Taiwan rows, which is to say on exactly the
 * Chinese-language coverage this pack exists to serve. Decoded on read rather
 * than at ingest so the whole current 30-day window is fixed, not just rows
 * written from now on.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Lone surrogates and out-of-range values would throw; hand back the
      // original text rather than lose the headline to one bad reference.
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The same transform in the other direction, so a caller searching in Chinese
 * can reach those headlines at all: the stored text is entity-encoded, so a
 * literal CJK query matches nothing no matter how many rows are there. Both
 * spellings ride in the one search, the way the fac pack carries both
 * spellings of a bilingual entity name — neither alone finds everything.
 */
function entityEncodeNonAscii(s: string): string {
  return [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp > 127 ? `&#x${cp.toString(16)};` : ch;
    })
    .join('');
}

/**
 * Strip the characters PostgREST parses structurally inside a logic tree so
 * caller text can never break out of the value it lands in — same approach as
 * the fac and open-contracting packs.
 */
function safePattern(v: string): string {
  return v.replace(/[,()"*\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every host that belongs to this publisher: the home domain itself, plus any
 * subdomain of it. GDELT records the serving host, so Xinhua arrives as
 * `english.news.cn` and never as the bare `news.cn` the census lists. The
 * suffix branch carries a leading dot on purpose — a bare `like.*epochtimes.com`
 * would also match `theepochtimes.com`, a different publisher.
 */
function hostBranches(domain: string): string[] {
  const d = encodeURIComponent(domain);
  return [`source_domain.eq.${d}`, `source_domain.like.*.${d}`];
}

/** An ISO instant for a caller-supplied date, or null if it is unusable. */
function asInstant(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** Resolve a caller's outlet token — a domain, a host, or a publisher name. */
function resolveOutlet(token: string): Outlet | undefined {
  const t = token.toLowerCase().trim();
  return (
    outletForHost(t) ??
    INDEXED_OUTLETS.find((o) => o.publisher.toLowerCase() === t) ??
    INDEXED_OUTLETS.find((o) => o.publisher.toLowerCase().includes(t) && t.length >= 3)
  );
}

function shapeArticle(row: GkgRow) {
  const outlet = outletForHost(row.source_domain);
  const themes = (row.themes ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  const tone = row.tone_avg === null ? null : Number(row.tone_avg);
  return {
    id: row.gkg_record_id,
    published_at: row.published_at,
    publisher: outlet?.publisher ?? row.source_domain,
    source_domain: row.source_domain,
    region: outlet?.region ?? null,
    lang: langOf(row.source_domain, outlet),
    title: row.title === null ? null : decodeEntities(row.title),
    ...(row.title === null
      ? {
          title_unavailable:
            'GDELT extracted no headline for this article (some publishers serve only a site-wide tagline, which is stored as absent rather than presented as a headline). The URL is the article.',
        }
      : {}),
    url: row.url,
    tone_avg: Number.isFinite(tone as number) ? tone : null,
    themes,
    body_available: false,
  };
}

// ── coverage ────────────────────────────────────────────────────────────────

interface CoverageRow {
  source_domain: string;
  published_at: string;
}

/**
 * Which publishers currently have indexed articles, and how recent they are —
 * measured by asking, never asserted from the census. Only called on the
 * empty-result path and by `china_news_outlets`, so the common case still
 * costs one round trip.
 */
async function liveCoverage(cfg: DataConfig): Promise<{
  domains: { source_domain: string; publisher: string; newest: string }[];
  newest: string | null;
  oldest: string | null;
} | null> {
  try {
    const rows = await pg<CoverageRow[]>(
      cfg,
      'select=source_domain,published_at&order=published_at.desc&limit=2000',
    );
    if (!rows.length) return { domains: [], newest: null, oldest: null };
    const byDomain = new Map<string, string>();
    for (const r of rows) {
      if (!byDomain.has(r.source_domain)) byDomain.set(r.source_domain, r.published_at);
    }
    return {
      domains: [...byDomain.entries()]
        .map(([source_domain, newest]) => ({
          source_domain,
          publisher: outletForHost(source_domain)?.publisher ?? source_domain,
          newest,
        }))
        .sort((a, b) => (a.newest < b.newest ? 1 : -1)),
      newest: rows[0].published_at,
      oldest: rows[rows.length - 1].published_at,
    };
  } catch {
    return null; // coverage is an explanation, never the reason a call fails
  }
}

// ── china_news_search ───────────────────────────────────────────────────────

interface SearchPlan {
  filters: string[];
  applied: Record<string, unknown>;
  candidates: Outlet[];
  error?: { error: string; message: string; retry_hint: string };
}

function planSearch(args: Record<string, unknown>): SearchPlan {
  const groups: string[] = [];
  const applied: Record<string, unknown> = {};
  const filters: string[] = [];

  // region -----------------------------------------------------------------
  const regionArg = typeof args.region === 'string' ? args.region.trim().toLowerCase() : '';
  let candidates = INDEXED_OUTLETS;
  if (regionArg) {
    if (!(REGIONS as readonly string[]).includes(regionArg)) {
      return {
        filters,
        applied,
        candidates,
        error: {
          error: 'unknown_region',
          message: `"${regionArg}" is not a region this index knows.`,
          retry_hint: `region must be one of: ${REGIONS.join(' | ')} — the publisher's own jurisdiction, which is NOT the same thing as the language it publishes in (use lang for that).`,
        },
      };
    }
    candidates = candidates.filter((o) => o.region === (regionArg as Region));
    applied.region = regionArg;
  }

  // outlets ----------------------------------------------------------------
  const outletTokens = asList(args.outlets);
  if (outletTokens.length) {
    const resolved: Outlet[] = [];
    const unknown: string[] = [];
    for (const tok of outletTokens) {
      const hit = resolveOutlet(tok);
      if (hit) resolved.push(hit);
      else unknown.push(tok);
    }
    if (!resolved.length) {
      return {
        filters,
        applied,
        candidates,
        error: {
          error: 'unknown_outlets',
          message: `None of ${JSON.stringify(outletTokens)} matched a publisher in this index.`,
          retry_hint:
            'Pass a home domain (e.g. "news.cn", "scmp.com") or a publisher name (e.g. "South China Morning Post"). Call china_news_outlets to list all 28 searchable publishers.',
        },
      };
    }
    const domains = new Set(resolved.map((o) => o.domain));
    candidates = candidates.filter((o) => domains.has(o.domain));
    applied.outlets = resolved.map((o) => o.domain);
    if (unknown.length) applied.outlets_unmatched = unknown;
  }

  // lang -------------------------------------------------------------------
  // Derived from the SERVING HOST, not from the publisher's home-edition
  // language: GDELT indexes the mainland state outlets' English editions
  // (english.news.cn, en.people.cn, en.gmw.cn, en.ce.cn) far more heavily than
  // their Chinese ones, and all four belong to publishers the census records
  // as `zh`. Filtering on the publisher's language would answer lang:"zh"
  // with English articles — the same class of mistake as answering a mainland
  // question with Taiwanese coverage (docs/china-news-plan.md sec 9).
  const langArg = typeof args.lang === 'string' ? args.lang.trim().toLowerCase() : '';
  if (langArg) {
    if (langArg !== 'zh' && langArg !== 'en') {
      return {
        filters,
        applied,
        candidates,
        error: {
          error: 'unknown_lang',
          message: `"${langArg}" is not a language this index knows.`,
          retry_hint: 'lang must be "zh" or "en".',
        },
      };
    }
    applied.lang = langArg;
    const enPublisherBranches = candidates
      .filter((o) => o.language === 'en')
      .flatMap((o) => hostBranches(o.domain));
    if (langArg === 'en') {
      groups.push(
        `or(source_domain.like.english.*,source_domain.like.en.*${
          enPublisherBranches.length ? ',' + enPublisherBranches.join(',') : ''
        })`,
      );
    } else {
      const zhBranches = candidates
        .filter((o) => o.language === 'zh')
        .flatMap((o) => hostBranches(o.domain));
      if (!zhBranches.length) {
        return {
          filters,
          applied,
          candidates: [],
          error: {
            error: 'no_matching_publishers',
            message: 'No Chinese-language publisher is both searchable and inside the other filters you passed.',
            retry_hint: 'Drop lang, or widen region/outlets. china_news_outlets lists which publishers are searchable.',
          },
        };
      }
      groups.push(
        `and(source_domain.not.like.english.*,source_domain.not.like.en.*,or(${zhBranches.join(',')}))`,
      );
    }
  }

  // publisher set ----------------------------------------------------------
  if (!candidates.length) {
    return {
      filters,
      applied,
      candidates,
      error: {
        error: 'no_matching_publishers',
        message: 'No searchable publisher satisfies the filters you passed together.',
        retry_hint: 'Relax region or outlets. china_news_outlets lists all 28 searchable publishers with their region and language.',
      },
    };
  }
  if (candidates.length < INDEXED_OUTLETS.length) {
    groups.push(`or(${candidates.flatMap((o) => hostBranches(o.domain)).join(',')})`);
  }

  // query ------------------------------------------------------------------
  const rawQuery = typeof args.query === 'string' ? args.query : '';
  const pattern = safePattern(rawQuery);
  if (pattern) {
    const enc = encodeURIComponent(pattern);
    // Themes and the URL slug are matched alongside the headline because ~15%
    // of rows carry no headline at all (GDELT extracted none) and would
    // otherwise be unreachable by any keyword.
    const branches = [`title.ilike.*${enc}*`, `url.ilike.*${enc}*`, `themes.ilike.*${enc}*`];
    const encodedPattern = entityEncodeNonAscii(pattern);
    if (encodedPattern !== pattern) {
      // ilike is case-insensitive, so this covers &#X8449; as well as &#x8449;.
      branches.push(`title.ilike.*${encodeURIComponent(encodedPattern)}*`);
      applied.query_spellings = [pattern, encodedPattern];
    }
    groups.push(`or(${branches.join(',')})`);
    applied.query = pattern;
    if (pattern !== rawQuery.trim()) applied.query_note = 'Punctuation that PostgREST parses structurally was removed from the search text.';
  }

  // window -----------------------------------------------------------------
  const since = asInstant(args.since);
  const until = asInstant(args.until);
  if (since) {
    filters.push(`published_at=gte.${encodeURIComponent(since)}`);
    applied.since = since;
  }
  if (until) {
    filters.push(`published_at=lte.${encodeURIComponent(until)}`);
    applied.until = until;
  }
  if (args.since !== undefined && !since) applied.since_ignored = `Could not read "${String(args.since)}" as a date; pass YYYY-MM-DD or an ISO timestamp.`;
  if (args.until !== undefined && !until) applied.until_ignored = `Could not read "${String(args.until)}" as a date; pass YYYY-MM-DD or an ISO timestamp.`;

  if (groups.length === 1) filters.push(groups[0].replace(/^or\(/, 'or=(').replace(/^and\(/, 'and=('));
  else if (groups.length > 1) filters.push(`and=(${groups.join(',')})`);

  return { filters, applied, candidates };
}

async function search(cfg: DataConfig, args: Record<string, unknown>) {
  const plan = planSearch(args);
  if (plan.error) return plan.error;

  const limit = clampInt(args.limit, 1, 100, 25);
  const query = [...plan.filters, SELECT, 'order=published_at.desc', `limit=${limit}`].join('&');
  const rows = await pg<GkgRow[]>(cfg, query);

  if (!rows.length) {
    // An empty answer has to say what it searched and what exists, or it is
    // indistinguishable from a broken tool (docs/silent-zero-policy.md).
    const cov = await liveCoverage(cfg);
    return {
      count: 0,
      articles: [],
      no_results: true,
      filters_applied: plan.applied,
      publishers_searched: plan.candidates.map((o) => o.domain),
      message:
        'No indexed article matched those filters. This is an empty result, not an error — the index holds a rolling ' +
        `${RETENTION_DAYS}-day window and coverage per publisher is genuinely sparse (many of these outlets publish only a few times a day, ` +
        'and GDELT indexes a subset of what they publish).',
      coverage_now: cov
        ? {
            publishers_with_articles: cov.domains.length,
            newest_article: cov.newest,
            oldest_article: cov.oldest,
            domains: cov.domains.slice(0, 30),
          }
        : null,
      retry_hint:
        'Widen the window (drop since/until), drop the region or lang filter, or search a broader term. ' +
        'coverage_now lists the publishers that currently have articles — searching one of those with no query at all is the way to see what is there.',
    };
  }

  return {
    count: rows.length,
    filters_applied: plan.applied,
    articles: rows.map(shapeArticle),
    source: 'GDELT Global Knowledge Graph (data.gdeltproject.org), article metadata only',
    note: `Rolling ${RETENTION_DAYS}-day window. GDELT indexes article metadata, never article text — use the url for the article itself.`,
  };
}

// ── china_news_article ──────────────────────────────────────────────────────

/** Spellings of one URL worth trying before declaring it unindexed. */
function urlVariants(raw: string): string[] {
  const out = new Set<string>([raw]);
  const trimmed = raw.replace(/\/+$/, '');
  out.add(trimmed);
  out.add(`${trimmed}/`);
  if (raw.startsWith('https://')) out.add(`http://${raw.slice(8)}`);
  if (raw.startsWith('http://')) out.add(`https://${raw.slice(7)}`);
  return [...out];
}

async function article(cfg: DataConfig, args: Record<string, unknown>) {
  const raw = typeof args.url === 'string' ? args.url.trim() : '';
  if (!raw) {
    return {
      error: 'missing_url',
      message: 'china_news_article needs the article url.',
      retry_hint: 'Pass the url exactly as china_news_search returned it.',
    };
  }

  let host = '';
  try {
    host = new URL(raw).host;
  } catch {
    return {
      error: 'unparseable_url',
      message: `"${raw}" is not a URL.`,
      retry_hint: 'Pass a full absolute URL, e.g. https://english.news.cn/20260911/…/c.html',
    };
  }

  const variants = urlVariants(raw);
  const branches = variants.map((v) => `url.eq.${encodeURIComponent(v)}`).join(',');
  const rows = await pg<GkgRow[]>(cfg, `or=(${branches})&${SELECT}&limit=1`);

  if (!rows.length) {
    const known = outletForHost(host);
    return {
      found: false,
      url: raw,
      // Never an empty body field: say which of the two reasons applies.
      message: known
        ? `${known.publisher} is a searchable publisher, but this URL is not in the index. The index holds a rolling ${RETENTION_DAYS}-day window of what GDELT chose to index, which is a subset of what the publisher published.`
        : `${host} is not one of the 28 publishers this index covers, so no article from it will ever be found here.`,
      publisher_indexed: Boolean(known),
      retry_hint: known
        ? 'Use china_news_search to find an article that IS indexed, then pass the url it returns verbatim.'
        : 'Call china_news_outlets to see which publishers are searchable.',
    };
  }

  const shaped = shapeArticle(rows[0]);
  const locations = (rows[0].locations ?? '')
    .split(';')
    .map((l) => l.split('#')[1]?.trim())
    .filter((l): l is string => Boolean(l))
    .slice(0, 12);

  return {
    found: true,
    article: { ...shaped, locations },
    body_available: false,
    // The honest refusal the task asks for: a named reason, not an empty string.
    body_unavailable_reason:
      'GDELT is a metadata index — it records that an article exists, its headline, themes, tone and location mentions, and never its text. No article body is available from this tool for any publisher. Follow article.url to read it.',
    source: 'GDELT Global Knowledge Graph (data.gdeltproject.org), article metadata only',
  };
}

// ── china_news_outlets ──────────────────────────────────────────────────────

async function outlets(cfg: DataConfig, args: Record<string, unknown>) {
  const regionArg = typeof args.region === 'string' ? args.region.trim().toLowerCase() : '';
  if (regionArg && !(REGIONS as readonly string[]).includes(regionArg)) {
    return {
      error: 'unknown_region',
      message: `"${regionArg}" is not a region in this census.`,
      retry_hint: `region must be one of: ${REGIONS.join(' | ')}.`,
    };
  }
  const methodArg = typeof args.method === 'string' ? args.method.trim().toLowerCase() : '';
  const searchableOnly = args.searchable_only === true || String(args.searchable_only ?? '').toLowerCase() === 'true';

  let rows = OUTLETS;
  if (regionArg) rows = rows.filter((o) => o.region === regionArg);
  if (methodArg) rows = rows.filter((o) => o.access.toLowerCase().includes(methodArg));
  if (searchableOnly) rows = rows.filter((o) => o.indexed);

  const cov = await liveCoverage(cfg);
  const live = new Map((cov?.domains ?? []).map((d) => [d.source_domain, d.newest]));
  const newestFor = (o: Outlet): string | null => {
    for (const [host, newest] of live) {
      if (host === o.domain || host.endsWith(`.${o.domain}`)) return newest;
    }
    return null;
  };

  return {
    count: rows.length,
    census_total: OUTLETS.length,
    searchable_total: INDEXED_OUTLETS.length,
    outlets: rows.map((o) => ({
      publisher: o.publisher,
      home_domain: o.domain,
      region: o.region,
      language: o.language,
      access_method: o.access,
      searchable: o.indexed,
      newest_indexed_article: o.indexed ? newestFor(o) : null,
    })),
    note:
      `${OUTLETS.length} publishers were audited; ${INDEXED_OUTLETS.length} of them are searchable through china_news_search today. ` +
      'The rest are recorded so coverage can be checked rather than assumed — a publisher with searchable:false will never appear in a search result. ' +
      'newest_indexed_article is null for a searchable publisher that simply has nothing in the current window, which is common: coverage per outlet is sparse.',
    source: 'Pipeworx China/HK/TW publisher census (fleet #1390); live article timestamps from the GDELT Global Knowledge Graph.',
  };
}

// ── tools ───────────────────────────────────────────────────────────────────

const REGION_HELP = `One of: ${REGIONS.join(' | ')} — the publisher's own jurisdiction (cn = mainland China, hk = Hong Kong, tw = Taiwan, overseas = diaspora/foreign Chinese-language outlets). This is NOT the language it publishes in; use lang for that.`;

const tools: McpToolExport['tools'] = [
  {
    name: 'china_news_search',
    description:
      'Search recent news coverage from Chinese, Hong Kong, Taiwanese and overseas-Chinese publishers — Xinhua, China Daily, Global Times, People\'s Daily, South China Morning Post, CNA Taiwan, CGTN, Caixin and 20 more — by keyword, publisher, jurisdiction, language and date. Returns headline, publisher, URL, publication time, GDELT themes and average article tone for each match. Use it to see how mainland state media, Hong Kong and Taiwanese outlets are covering a topic, and how that differs. Article metadata only, from the GDELT Global Knowledge Graph: there is no article text — follow the url. Covers a rolling 30-day window. Call china_news_outlets to see exactly which publishers are searchable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Free text, matched case-insensitively against the headline, the article URL and GDELT\'s theme tags, e.g. "Taiwan", "semiconductor", "BRICS". Omit to browse the most recent articles for the other filters.',
        },
        region: { type: 'string', description: REGION_HELP },
        outlets: {
          type: ['string', 'array'],
          items: { type: 'string' },
          description:
            'Restrict to specific publishers — a home domain ("news.cn", "scmp.com") or a publisher name ("South China Morning Post"). Comma-separated string or array.',
        },
        lang: {
          type: 'string',
          description:
            'Publishing language of the edition the article appeared in: "zh" or "en". Note that most mainland state outlets run a separate English edition on its own host (english.news.cn, en.people.cn), and this filter reads that host — so lang:"en" does return Xinhua and People\'s Daily.',
        },
        since: { type: 'string', description: 'Only articles published at or after this date — YYYY-MM-DD or an ISO timestamp.' },
        until: { type: 'string', description: 'Only articles published at or before this date — YYYY-MM-DD or an ISO timestamp.' },
        limit: { type: ['number', 'string'], description: 'Max articles (1-100, default 25).' },
      },
      required: [],
    },
  },
  {
    name: 'china_news_article',
    description:
      'Look up one indexed China/Hong Kong/Taiwan news article by its URL and return everything known about it: publisher, headline, publication time, GDELT theme tags, average article tone and the places it mentions. Pass a url exactly as china_news_search returned it. There is no article text — GDELT indexes metadata only — and this tool says so explicitly rather than returning an empty body field.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The article URL, as returned by china_news_search.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'china_news_outlets',
    description:
      'List the Chinese, Hong Kong, Taiwanese and overseas-Chinese news publishers Pipeworx has audited — 106 of them — with each one\'s jurisdiction, publishing language, how its content is reachable, whether china_news_search can actually search it, and when its most recent indexed article was published. Use this before searching to see what coverage genuinely exists, instead of inferring it from an empty search result.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        region: { type: 'string', description: REGION_HELP },
        method: {
          type: 'string',
          description:
            'Filter by how the publisher\'s content is reachable: "gdelt-only", "native-rss" or "scrape" (substring match).',
        },
        searchable_only: {
          type: ['boolean', 'string'],
          description: 'true to list only the publishers china_news_search can actually search.',
        },
      },
      required: [],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const url = (args._supabaseUrl as string | undefined)?.trim();
  const key = (args._supabaseKey as string | undefined)?.trim();
  if (!url || !key) {
    throw new Error(
      'china-news is not configured on this deployment — an operator must enable its data credentials. This is a setup problem, not your arguments.',
    );
  }
  const cfg: DataConfig = { url, key };

  switch (name) {
    case 'china_news_search':
      return search(cfg, args);
    case 'china_news_article':
      return article(cfg, args);
    case 'china_news_outlets':
      return outlets(cfg, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
