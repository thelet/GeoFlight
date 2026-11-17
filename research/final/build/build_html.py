#!/usr/bin/env python3
"""Build research/final/index.html from research/report_v3.md.

Reproducible: python3 research/final/build/build_html.py
Requires: markdown-it-py (pip install markdown-it-py mdit-py-plugins)

Pipeline
  1. split the report into body / glossary / references
  2. protect $...$ / $$...$$ math with placeholders (restored verbatim for MathJax)
  3. markdown-it (CommonMark + tables) -> HTML; ```mermaid -> <pre class="mermaid">
  4. heading ids (s1-2-3 for numbered sections, ch1 for chapters)
  5. text pass: [Key] citations -> numbered links (References order), evidence tags -> badges,
     §x.y links, glossary tooltips (first occurrence per section)
  6. structure: hero, chapters, key-takeaway boxes, Risk/Recommendation/Note callouts,
     widgets and the capture-protocol figure injected by heading id
  7. inline CSS/JS from this directory -> one self-contained file
"""
import html
import json
import re
import sys
from pathlib import Path

from markdown_it import MarkdownIt

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent.parent
REPORT = RESEARCH / "report_v3.md"
SOURCES = RESEARCH / "sources.json"
OUT = HERE.parent / "index.html"

# Citation keys used in the text that are not in the references list -> canonical key.
KEY_ALIASES = {"Tu2026GOFish": "GOFish"}

TAG_RE = re.compile(
    r"^(UNVERIFIED|OPENED|DJI-MANUAL|DJI-SPEC|DJI-FAQ|CALC|SRC|SNIPPET|ABS|TRANSFER|UPSTREAM|assessment|venue UNVERIFIED|form UNVERIFIED)\b"
)

# --------------------------------------------------------------------------------------
# 1. split
# --------------------------------------------------------------------------------------
src = REPORT.read_text(encoding="utf-8")
i_gl = src.index("\n# Glossary")
i_ref = src.index("\n# References")
body_md = src[:i_gl]
gloss_md = src[i_gl:i_ref]
refs_md = src[i_ref:]

lines = body_md.split("\n")
title = lines[0].lstrip("# ").strip()
subtitle_line = lines[2].strip()
body_md = "\n".join(lines[3:])

# chapters '# Chapter N' -> '## Chapter N' (page h1 is the title)
body_md = re.sub(r"^# (Chapter \d+:.*)$", r"## \1", body_md, flags=re.M)

# --------------------------------------------------------------------------------------
# references
# --------------------------------------------------------------------------------------
sources = {s["key"]: s for s in json.loads(SOURCES.read_text(encoding="utf-8"))}
ref_entries = []  # (n, key, raw)
for m in re.finditer(r"^(\d+)\. \*\*\[([^\]]+)\]\*\* (.*)$", refs_md, flags=re.M):
    ref_entries.append((int(m.group(1)), m.group(2), m.group(3)))
key_to_n = {k: n for n, k, _ in ref_entries}
for a, b in KEY_ALIASES.items():
    key_to_n[a] = key_to_n[b]
assert len(ref_entries) == len(sources), (len(ref_entries), len(sources))
refs_intro = refs_md.split("\n\n")[1].strip()

# --------------------------------------------------------------------------------------
# glossary
# --------------------------------------------------------------------------------------
gloss = []  # (slug, term_display, definition_md, match_terms)
for m in re.finditer(r"^- \*\*(.+?):\*\* (.*)$", gloss_md, flags=re.M):
    term, defin = m.group(1), m.group(2)
    main = re.sub(r"\s+\(.*?\)", " ", term).strip()
    paren = re.findall(r"\((.*?)\)", term)
    slug = "gl-" + re.sub(r"[^a-z0-9]+", "-", main.lower()).strip("-")
    variants = [main]

    def is_acr(s):
        return bool(re.fullmatch(r"[A-Za-z0-9\-/]+", s)) and sum(c.isupper() for c in s) >= 2

    for p in paren:
        for alt in re.split(r",|;| or ", p):
            alt = alt.strip()
            if alt and (is_acr(alt) or is_acr(main)) and len(alt) <= 40 and not alt.lower().startswith("e.g"):
                variants.append(alt)
    gloss.append((slug, term, defin, variants))

# --------------------------------------------------------------------------------------
# 2. protect math
# --------------------------------------------------------------------------------------
math_store = []


def _math_sub(m):
    math_store.append(m.group(0))
    return f"MATHPH{len(math_store) - 1}ZZ"


def protect_math(md):
    out, pos = [], 0
    # skip fenced code
    parts = re.split(r"(^```.*?^```)", md, flags=re.M | re.S)
    for idx, part in enumerate(parts):
        if idx % 2 == 1:
            out.append(part)
            continue
        part = re.sub(r"\$\$(.+?)\$\$", _math_sub, part, flags=re.S)
        part = re.sub(r"(?<![\\$])\$(?!\s)([^$\n]+?)(?<![\s\\])\$", _math_sub, part)
        out.append(part)
    return "".join(out)


body_md = protect_math(body_md)

# --------------------------------------------------------------------------------------
# 3. markdown-it
# --------------------------------------------------------------------------------------
md = MarkdownIt("commonmark", {"html": False, "typographer": False}).enable("table").enable("strikethrough")


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or "sec"


used_ids = set()
heading_index = []  # (level, id, text)


def unique(i):
    base, n = i, 2
    while i in used_ids:
        i = f"{base}-{n}"
        n += 1
    used_ids.add(i)
    return i


def heading_id_rule(state):
    toks = state.tokens
    for k, t in enumerate(toks):
        if t.type == "heading_open":
            text = toks[k + 1].content
            plain = re.sub(r"MATHPH\d+ZZ", "", text)
            m = re.match(r"Chapter (\d+):", plain)
            m2 = re.match(r"(\d+(?:\.\d+)+)\s", plain)
            if m:
                hid = f"ch{m.group(1)}"
            elif m2:
                hid = "s" + m2.group(1).replace(".", "-")
            else:
                hid = slugify(plain)
            hid = unique(hid)
            t.attrSet("id", hid)
            heading_index.append((int(t.tag[1]), hid, plain))


md.core.ruler.push("heading_ids", heading_id_rule)


def fence(self, tokens, idx, options, env):
    t = tokens[idx]
    info = (t.info or "").strip()
    content = html.escape(t.content)
    if info == "mermaid":
        return f'<div class="diagram" role="img" aria-label="Flowchart (Mermaid source shown if the renderer is unavailable)"><pre class="mermaid">{content}</pre></div>\n'
    return f"<pre><code>{content}</code></pre>\n"


md.add_render_rule("fence", fence)
md.add_render_rule("code_block", fence)

body_html = md.render(body_md)
section_ids = {hid for _, hid, _ in heading_index}

# --------------------------------------------------------------------------------------
# 5. text pass
# --------------------------------------------------------------------------------------
first_cite_id = {}
cite_counter = [0]
uv_counter = [0]

KEY_WORD_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, key_to_n), key=len, reverse=True)) + r")\b")


def cite_link(key):
    n = key_to_n[key]
    cite_counter[0] += 1
    cid = f"c{cite_counter[0]}"
    first_cite_id.setdefault(n, cid)
    title_attr = html.escape(sources[KEY_ALIASES.get(key, key)]["title"], quote=True)
    return f'<a id="{cid}" href="#ref-{n}" title="{key}: {title_attr}">{n}</a>'


def linkify_keys_in(text):
    # text is already-escaped html text; keys are plain identifiers
    return KEY_WORD_RE.sub(lambda m: f'<span class="ref-inline">{m.group(1)}<sup class="cite">[{cite_link(m.group(1))}]</sup></span>', text)


def tag_class(content):
    if "UNVERIFIED" in content:
        return "tag-unverified"
    first = content.split(":")[0].split()[0] if content.split() else ""
    if first.startswith("SNIPPET"):
        return "tag-snippet"
    if first.startswith("DJI"):
        return "tag-dji"
    if first.startswith("OPENED") or first.startswith("SRC"):
        return "tag-opened"
    if first.startswith("assessment"):
        return "tag-assessment"
    return "tag-calc"


def bracket_sub(m):
    inner = m.group(1)
    parts = [p.strip() for p in re.split(r"[;,]", inner)]
    if parts and all(p in key_to_n for p in parts):
        links = ", ".join(cite_link(p) for p in parts)
        return f'<sup class="cite">[{links}]</sup>'
    plain = html.unescape(inner)
    if TAG_RE.match(plain) or plain.startswith("OPENED") or "UNVERIFIED" in plain:
        cls = tag_class(plain)
        extra = ""
        if cls == "tag-unverified":
            uv_counter[0] += 1
            extra = f' id="uv{uv_counter[0]}"'
        return f'<span class="tag {cls}"{extra}>{linkify_keys_in(inner)}</span>'
    if KEY_WORD_RE.search(inner):
        return "[" + linkify_keys_in(inner) + "]"
    return m.group(0)


BRACKET_RE = re.compile(r"\[([^\[\]<>]{1,300})\]")


def sect_sub(m):
    num = m.group(1).rstrip(".")
    sid = "s" + num.replace(".", "-")
    if sid in section_ids:
        return f'<a class="xref" href="#{sid}">§{num}</a>'
    return m.group(0)


SECT_RE = re.compile(r"§(\d+\.\d+(?:\.\d+)*)")
CH_RE = re.compile(r"\b(Chs?\. )(\d)\b")


def ch_sub(m):
    if f"ch{m.group(2)}" in section_ids:
        return f'{m.group(1)}<a class="xref" href="#ch{m.group(2)}">{m.group(2)}</a>'
    return m.group(0)

# glossary regex
gl_terms = {}
for slug, term, defin, variants in gloss:
    for v in variants:
        gl_terms.setdefault(v, slug)
acronyms = {v for v in gl_terms if sum(c.isupper() for c in v) >= 2 or not re.search(r"[a-z]", v)}
words = [v for v in gl_terms if v not in acronyms]
gl_word_re = re.compile(r"(?<![\w\-/.])(" + "|".join(sorted(map(re.escape, words), key=len, reverse=True)) + r")(?:s|es)?(?![\w\-])", re.I)
gl_acr_re = re.compile(r"(?<![\w\-/.])(" + "|".join(sorted(map(re.escape, acronyms), key=len, reverse=True)) + r")s?(?![\w\-])")
lower_map = {v.lower(): s for v, s in gl_terms.items()}


def process_text_segments(h, do_gloss=True):
    """Walk an HTML string; transform text nodes outside pre/code (and other skip contexts)."""
    out = []
    stack = []
    section_used = set()
    tokens = re.split(r"(<[^>]+>)", h)
    for tok in tokens:
        if tok.startswith("<"):
            mt = re.match(r"<(/?)([a-zA-Z0-9]+)", tok)
            if mt:
                closing, name = mt.group(1) == "/", mt.group(2).lower()
                if name in ("h2", "h3") and not closing:
                    section_used = set()
                if name not in ("br", "hr", "img", "input"):
                    if closing:
                        if name in stack:
                            while stack and stack.pop() != name:
                                pass
                    elif not tok.endswith("/>"):
                        stack.append(name)
            out.append(tok)
            continue
        if not tok:
            continue
        if "pre" in stack or "code" in stack:
            out.append(tok)
            continue
        t = tok
        t = BRACKET_RE.sub(bracket_sub, t)
        # Split again so section/glossary passes don't touch inserted markup
        sub = re.split(r"(<[^>]+>.*?</(?:a|sup|span)>|<[^>]+>)", t)
        res = []
        in_heading = any(x in stack for x in ("h1", "h2", "h3", "h4", "h5", "a"))
        for s in sub:
            if not s or s.startswith("<"):
                res.append(s)
                continue
            if not in_heading:
                s = SECT_RE.sub(sect_sub, s)
                s = CH_RE.sub(ch_sub, s)
            if do_gloss and not in_heading and "th" not in stack:
                s = gloss_sub(s, section_used)
            res.append(s)
        out.append("".join(res))
    return "".join(out)


def gloss_sub(s, used):
    pieces = re.split(r"(<a [^>]*>.*?</a>|MATHPH\d+ZZ)", s)
    res = []
    for p in pieces:
        if not p or p.startswith("<a ") or p.startswith("MATHPH"):
            res.append(p)
            continue

        def rep(m, acr):
            word = m.group(1)
            slug = gl_terms.get(word) if acr else lower_map.get(word.lower())
            if not slug or slug in used:
                return m.group(0)
            used.add(slug)
            return f'<span class="gloss" tabindex="0" data-g="{slug}">{m.group(0)}</span>'

        p = gl_acr_re.sub(lambda m: rep(m, True), p)
        # word terms: avoid re-matching inside inserted spans
        segs = re.split(r"(<span class=\"gloss\"[^>]*>.*?</span>)", p)
        segs = [x if x.startswith("<span") else gl_word_re.sub(lambda m: rep(m, False), x) for x in segs]
        res.append("".join(segs))
    return "".join(res)


body_html = process_text_segments(body_html)

# merge adjacent citation groups: </sup><sup class="cite">[ -> ,
body_html = re.sub(r"\]</sup><sup class=\"cite\">\[", ", ", body_html)

# --------------------------------------------------------------------------------------
# restore math
# --------------------------------------------------------------------------------------


def restore_math(h):
    def rep(m):
        raw = math_store[int(m.group(1))]
        esc = html.escape(raw, quote=False)
        if raw.startswith("$$"):
            return f'<span class="math-display" role="math">{esc}</span>'
        return f'<span class="math-inline">{esc}</span>'

    h = re.sub(r"<p>MATHPH(\d+)ZZ</p>", lambda m: f'<div class="math-display" role="math">{html.escape(math_store[int(m.group(1))], quote=False)}</div>', h)
    return re.sub(r"MATHPH(\d+)ZZ", rep, h)


# --------------------------------------------------------------------------------------
# 6. structure
# --------------------------------------------------------------------------------------
# tables -> wrap
body_html = re.sub(r"<table>", '<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>', body_html)
body_html = body_html.replace("</table>", "</table></div>")

# blockquotes -> note callouts
body_html = re.sub(r"<blockquote>\s*", '<aside class="callout note"><span class="callout-label">Note</span>\n', body_html)
body_html = body_html.replace("</blockquote>", "</aside>")

# key takeaways boxes
body_html = re.sub(
    r'(<h3 id="(key-takeaways[^"]*)">Key takeaways</h3>\s*)(<ol>.*?</ol>)',
    lambda m: f'<div class="takeaways" role="note" aria-labelledby="{m.group(2)}">{m.group(1)}{m.group(3)}</div>',
    body_html,
    flags=re.S,
)


def wrap_callout(kind, label):
    def f(m):
        return f'<div class="callout {kind}"><span class="callout-label">{label}</span>\n{m.group(0)}</div>'

    return f


FOLLOW = r'(?:\s*(?:<ol>.*?</ol>|<ul>.*?</ul>|<div class="table-wrap".*?</table></div>))?'
body_html = re.sub(r"<p><strong>(?:Top risks|Risks[^<]*)</strong>[^\n]*</p>" + FOLLOW, wrap_callout("risk", "Risks"), body_html, flags=re.S)
body_html = re.sub(
    r'(<h4 id="s6-5-5">.*?</h4>)\s*(<div class="table-wrap".*?</table></div>)',
    lambda m: m.group(1) + '<div class="callout risk"><span class="callout-label">Risks → fallbacks</span>' + m.group(2) + "</div>",
    body_html,
    flags=re.S,
)

REC_P = re.compile(r"<p><strong>(?:Recommendation|Recommended)(?:(?!</p>).)*</p>", re.S)
FOLLOW_RE = re.compile(r'\s*(?:<ol>.*?</ol>|<ul>.*?</ul>|<div class="table-wrap".*?</table></div>)', re.S)


def wrap_recs(h):
    out, pos = [], 0
    for m in REC_P.finditer(h):
        if m.start() < pos:
            continue
        end = m.end()
        plain = re.sub(r"<[^>]+>", "", m.group(0)).strip()
        if plain.endswith(":"):
            f = FOLLOW_RE.match(h, end)
            if f:
                end = f.end()
        out.append(h[pos:m.start()])
        out.append('<div class="callout rec"><span class="callout-label">Recommendation</span>\n' + h[m.start():end] + "</div>")
        pos = end
    out.append(h[pos:])
    return "".join(out)


body_html = wrap_recs(body_html)
body_html = re.sub(
    r'(<h4 id="s6-8-2">.*?</h4>)\s*(<p>.*?</p>)',
    lambda m: m.group(1) + '<div class="callout rec"><span class="callout-label">Recommendation</span>' + m.group(2) + "</div>",
    body_html,
    flags=re.S,
)

# heading decoration: number spans + anchor links
def deco_heading(m):
    tag, hid, inner = m.group(1), m.group(2), m.group(3)
    mm = re.match(r"(\d+(?:\.\d+)+)\s+(.*)", inner, flags=re.S)
    if mm:
        inner = f'<span class="hn">{mm.group(1)}</span>{mm.group(2)}'
    if tag == "h2":
        mc = re.match(r"Chapter (\d+):\s*(.*)", inner, flags=re.S)
        if mc:
            inner = f'<span class="chapter-num">Chapter {mc.group(1)}</span>{mc.group(2)}'
    anchor = "" if tag == "h2" else f'<a class="anchor-link" href="#{hid}" aria-label="Link to this section">#</a>'
    return f'<{tag} id="{hid}">{inner}{anchor}</{tag}>'


body_html = re.sub(r'<(h[2-5]) id="([^"]+)">(.*?)</\1>', deco_heading, body_html, flags=re.S)

# --------------------------------------------------------------------------------------
# widgets & figures (by heading id: inserted before that heading)
# --------------------------------------------------------------------------------------
frag_src = (HERE / "widgets.html").read_text(encoding="utf-8")
frags = dict(re.findall(r"<!-- FRAG:(\S+) -->\n(.*?)<!-- /FRAG -->", frag_src, flags=re.S))
frags = {k: (v if k == "hero" else process_text_segments(v, do_gloss=False)) for k, v in frags.items()}
INSERT_BEFORE = {
    "s1-2-3": "w-seam",
    "s1-7": "fig-capture",
    "s2-1-2": "w-pinhole",
    "s2-1-5": "w-triang",
    "s2-4-4": "w-splat",
    "s2-5-2": "w-erp",
    "s3-2-2": "w-blur",
    "s4-3-3": "w-scale",
    "s6-8-2": "w-compare",
}
for hid, frag in INSERT_BEFORE.items():
    pat = f'<h3 id="{hid}">' if hid.count("-") == 1 else f'<h4 id="{hid}">'
    if pat not in body_html:
        sys.exit(f"anchor {hid} not found for {frag}")
    body_html = body_html.replace(pat, frags[frag] + "\n" + pat, 1)

# --------------------------------------------------------------------------------------
# split into sections (h2)
# --------------------------------------------------------------------------------------
chunks = re.split(r'(?=<h2 id=")', body_html)
front_intro = chunks[0]
sections_html = []
changelogs = []
for ch in chunks[1:]:
    hid = re.match(r'<h2 id="([^"]+)"', ch).group(1)
    if hid.startswith("changelog"):
        changelogs.append(re.sub(r"<(/?)h2", r"<\1h3", ch, count=2))
        continue
    cls = "chapter" if hid.startswith("ch") and hid[2:].isdigit() else "front"
    if cls == "chapter":
        # unverified callout placeholder after takeaways (filled by JS) or after first paragraph block
        ins = '<details class="unverified-list" data-chapter="' + hid + '"><summary>Unverified items in this chapter</summary><p class="w-sub">Every <span class="tag tag-unverified">UNVERIFIED</span> tag in this chapter, with its context. Select one to jump to it.</p><ol></ol></details>'
        if '<div class="takeaways"' in ch:
            ch = re.sub(r'(<div class="takeaways".*?</ol></div>)', lambda m: m.group(1) + ins, ch, count=1, flags=re.S)
        else:
            ch = re.sub(r"(</h2>\s*<p>.*?</p>)", lambda m: m.group(1) + ins, ch, count=1, flags=re.S)
    sections_html.append(f'<section class="{cls}" aria-labelledby="{hid}">\n{ch}</section>')

changelog_html = (
    '<section class="front" aria-labelledby="changelogs"><h2 id="changelogs">Changelogs</h2>'
    '<details class="changelog"><summary>Review rounds 1 and 2: what changed (v1 → v2 → v3)</summary>'
    + "".join(changelogs)
    + "</details></section>"
)
# keep original anchors for changelog headings
for _, hid, _ in heading_index:
    pass

# glossary section
gl_items = []
for slug, term, defin, variants in gloss:
    d = protect_math(defin)
    d_html = md.renderInline(d)
    d_html = process_text_segments(d_html, do_gloss=False)
    d_html = restore_math(d_html)
    gl_items.append(f'<dt id="{slug}">{html.escape(term)}</dt><dd>{d_html}</dd>')
glossary_html = (
    '<section class="front" aria-labelledby="glossary"><h2 id="glossary">Glossary</h2>'
    '<p class="w-sub">Terms marked with a dotted underline in the text show these definitions on hover, focus or tap.</p>'
    f'<dl class="glossary">{"".join(gl_items)}</dl></section>'
)


# references section
def render_ref(n, key, raw):
    s = html.escape(raw, quote=False)
    s = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", s)
    s = re.sub(r"&lt;(https?://[^&\s]+?)&gt;", lambda m: f'<a href="{m.group(1)}" target="_blank" rel="noopener">{m.group(1)}</a>', s)
    back = f' <a class="back" href="#{first_cite_id[n]}" aria-label="Back to first citation">↩ first cited</a>' if n in first_cite_id else ""
    return f'<li id="ref-{n}"><span class="rn">{n}.</span><span><span class="rk">[{html.escape(key)}]</span> {s}{back}</span></li>'


refs_html = (
    '<section class="front" aria-labelledby="references"><h2 id="references">References</h2>'
    f"<p>{html.escape(refs_intro).replace('`research/sources.json`', '<code>research/sources.json</code>')}</p>"
    '<p class="w-sub">Numbers follow the report\'s alphabetical reference list. All links open in a new tab.</p>'
    f'<ol class="refs">{"".join(render_ref(*e) for e in ref_entries)}</ol></section>'
)

main_html = changelog_html + "\n".join(sections_html) + glossary_html + refs_html
main_html = restore_math(main_html)
front_intro = restore_math(front_intro)

# external links in body
main_html = re.sub(r'<a href="(https?://[^"]+)"(?![^>]*target=)', r'<a href="\1" target="_blank" rel="noopener"', main_html)

# --------------------------------------------------------------------------------------
# TOC
# --------------------------------------------------------------------------------------
toc_items = []
cur = None
for lvl, hid, text in heading_index:
    if hid.startswith("changelog"):
        continue
    text = re.sub(r"MATHPH\d+ZZ", "", text)
    if lvl == 2:
        label = re.sub(r"^Chapter (\d+):", r"\1 ·", text)
        cur = {"id": hid, "label": label, "subs": []}
        toc_items.append(cur)
    elif lvl == 3 and cur is not None and not hid.startswith("key-takeaways"):
        cur["subs"].append((hid, text))
toc_items.insert(0, {"id": "changelogs", "label": "Changelogs", "subs": []})
toc_items.append({"id": "glossary", "label": "Glossary", "subs": []})
toc_items.append({"id": "references", "label": "References", "subs": []})
toc_html = ['<div class="toc-title">Contents</div><ol>']
toc_html.append('<li class="toc-ch"><a href="#top">Overview</a></li>')
for it in toc_items:
    subs = ""
    if it["subs"]:
        subs = '<ol class="toc-sub">' + "".join(f'<li><a href="#{h}">{html.escape(t)}</a></li>' for h, t in it["subs"]) + "</ol>"
    toc_html.append(f'<li class="toc-ch"><a href="#{it["id"]}">{html.escape(it["label"])}</a>{subs}</li>')
toc_html.append("</ol>")

# --------------------------------------------------------------------------------------
# hero
# --------------------------------------------------------------------------------------
hero_html = frags["hero"].replace("{{TITLE}}", html.escape(title)).replace(
    "{{SUBTITLE}}", md.renderInline(subtitle_line.strip("*"))
)
hero_html = process_text_segments(hero_html, do_gloss=False)
hero_html = re.sub(r"\]</sup><sup class=\"cite\">\[", ", ", hero_html)

# --------------------------------------------------------------------------------------
# glossary data for tooltips, assemble
# --------------------------------------------------------------------------------------
css = (HERE / "style.css").read_text(encoding="utf-8")
app_js = (HERE / "app.js").read_text(encoding="utf-8")
widgets_js = (HERE / "widgets.js").read_text(encoding="utf-8")

page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Avata 360 Garage Survey</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Interactive research report: from DJI Avata 360 flight video to a metric 3D model and a Gaussian-splat visualization of an underground car park.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap">
<style>
{css}
</style>
<script>
(function(){{try{{var t=localStorage.getItem('a360-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}}catch(e){{}}}})();
window.MathJax = {{
  tex: {{ inlineMath: [['$','$']], displayMath: [['$$','$$']], processEscapes: true }},
  svg: {{ fontCache: 'global' }},
  options: {{ skipHtmlTags: ['script','noscript','style','textarea','pre','code'], ignoreHtmlClass: 'no-math' }},
  startup: {{ typeset: true }}
}};
</script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js"></script>
</head>
<body>
<a class="sr-only" href="#main">Skip to content</a>
<div class="page" id="top">
<header class="topbar">
  <button class="icon-btn toc-toggle" id="toc-toggle" aria-controls="toc" aria-expanded="false">Contents</button>
  <a class="brand" href="#top">Avata 360 → <span>metric garage model</span></a>
  <button class="icon-btn" id="theme-toggle" aria-label="Toggle dark mode">Dark</button>
  <div class="progress" aria-hidden="true"><div id="progress-bar"></div></div>
</header>
<div class="layout">
<nav class="toc" id="toc" aria-label="Table of contents">
{''.join(toc_html)}
</nav>
<main id="main">
{hero_html}
<div class="front-intro">{front_intro}</div>
{main_html}
</main>
</div>
</div>
<div id="gloss-tip" role="tooltip"></div>
<script>
{app_js}
</script>
<script>
{widgets_js}
</script>
<script id="mermaid-lib" src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<script id="mermaid-init">
(function(){{
  if (!window.mermaid) return;
  var nodes = Array.prototype.slice.call(document.querySelectorAll('pre.mermaid'));
  nodes.forEach(function(n){{ n.setAttribute('data-src', n.textContent); }});
  function dark(){{ var t=document.documentElement.getAttribute('data-theme'); if(t) return t==='dark'; return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches; }}
  function render(){{
    try {{
      mermaid.initialize({{ startOnLoad: false, securityLevel: 'strict', theme: dark() ? 'dark' : 'neutral', flowchart: {{ useMaxWidth: false, htmlLabels: true }}, fontFamily: 'IBM Plex Sans, system-ui, sans-serif' }});
      nodes.forEach(function(n){{ n.removeAttribute('data-processed'); n.textContent = n.getAttribute('data-src'); }});
      var p = mermaid.run({{ nodes: nodes }});
      if (p && p.catch) p.catch(function(e){{ console.warn('mermaid render failed', e); }});
    }} catch (e) {{ console.warn('mermaid unavailable', e); }}
  }}
  render();
  document.addEventListener('a360-themechange', render);
}})();
</script>
</body>
</html>
"""
OUT.write_text(page, encoding="utf-8")
n_cites = cite_counter[0]
print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB); citations={n_cites}, refs cited={len(first_cite_id)}/{len(ref_entries)}, unverified tags={uv_counter[0]}, math={len(math_store)}")
