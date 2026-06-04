"""Research search helpers for real literature/data prefetching."""

from __future__ import annotations

import json
import logging
import os
import re
import ssl
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from typing import Any

logger = logging.getLogger(__name__)
HTTP_TIMEOUT = int(os.getenv("AGENT_MEETTING_SEARCH_TIMEOUT", "8"))
MAX_SEARCH_QUERIES = int(os.getenv("AGENT_MEETTING_SEARCH_QUERIES", "3"))
USER_AGENT = "agent-meetting/0.2 (research meeting prefetch)"
BROWSER_TIMEOUT_MS = int(os.getenv("AGENT_MEETTING_BROWSER_TIMEOUT_MS", "20000"))
CHROME_APP_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


# ───────────── Data model ─────────────


@dataclass
class Paper:
    title: str = ""
    authors: str = ""
    year: str = ""
    journal: str = ""
    doi: str = ""
    pmid: str = ""
    abstract: str = ""
    source: str = ""
    url: str = ""
    citation_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GeoDataset:
    accession: str = ""
    title: str = ""
    organism: str = ""
    type: str = ""
    samples: str = ""
    url: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResearchContext:
    trusted_references: str = ""
    papers: list[Paper] = field(default_factory=list)
    datasets: list[GeoDataset] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    excluded_papers: int = 0

    def to_markdown(self) -> str:
        lines = ["# Real Research Search Context", ""]
        if self.trusted_references.strip():
            lines.append("## Trusted User References")
            lines.append("The following user-provided references are the highest-priority evidence for this meeting.")
            lines.append("")
            lines.append(self.trusted_references.strip())
            lines.append("")

        if self.papers:
            lines.append("## Papers")
            for index, paper in enumerate(self.papers, 1):
                lines.append(f"{index}. **{paper.title or 'Untitled'}**")
                detail = " | ".join(
                    item for item in [
                        paper.authors,
                        paper.journal,
                        paper.year,
                        f"DOI: {paper.doi}" if paper.doi else "",
                        f"PMID: {paper.pmid}" if paper.pmid else "",
                        paper.url,
                    ] if item
                )
                if detail:
                    lines.append(f"   {detail}")
                if paper.abstract:
                    lines.append(f"   Abstract: {paper.abstract[:700]}")
                lines.append("")
        else:
            lines.append("## Papers")
            lines.append("No papers were retrieved by the built-in web search.")
            lines.append("")

        if self.datasets:
            lines.append("## Datasets")
            for index, dataset in enumerate(self.datasets, 1):
                lines.append(f"{index}. **{dataset.accession or 'GEO'}**: {dataset.title}")
                detail = " | ".join(
                    item for item in [
                        dataset.organism,
                        dataset.type,
                        f"samples: {dataset.samples}" if dataset.samples else "",
                        dataset.url,
                    ] if item
                )
                if detail:
                    lines.append(f"   {detail}")
                lines.append("")
        else:
            lines.append("## Datasets")
            lines.append("No GEO datasets were retrieved by the built-in web search.")
            lines.append("")

        if self.errors:
            lines.append("## Search Warnings")
            for error in self.errors:
                lines.append(f"- {error}")
        if self.excluded_papers:
            lines.append("")
            lines.append(f"Filtered out {self.excluded_papers} weakly related search results before the agents saw them.")
        return "\n".join(lines).strip() + "\n"


def _get_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as first_exc:
        context = ssl._create_unverified_context()
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT, context=context) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError as second_exc:
            return _get_json_with_curl(url, first_exc, second_exc)


def _get_json_with_curl(url: str, first_exc: Exception, second_exc: Exception) -> dict[str, Any]:
    cmd = [
        "curl",
        "--location",
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        str(HTTP_TIMEOUT),
        "--user-agent",
        USER_AGENT,
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=HTTP_TIMEOUT + 2)
    except (subprocess.SubprocessError, FileNotFoundError) as curl_exc:
        raise urllib.error.URLError(
            f"urllib failed: {first_exc}; unverified urllib failed: {second_exc}; curl failed: {curl_exc}"
        ) from curl_exc
    if result.returncode != 0:
        raise urllib.error.URLError(
            f"urllib failed: {first_exc}; unverified urllib failed: {second_exc}; "
            f"curl returncode={result.returncode}: {result.stderr.strip()}"
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as json_exc:
        raise urllib.error.URLError(f"curl returned non-JSON response: {json_exc}") from json_exc


def _deduplicate_papers(papers: list[Paper], limit: int) -> list[Paper]:
    seen: set[str] = set()
    unique: list[Paper] = []
    for paper in papers:
        key = paper.doi.lower() if paper.doi else paper.pmid or re.sub(r"[^a-z0-9]", "", paper.title.lower())[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(paper)
        if len(unique) >= limit:
            break
    return unique


def _goal_terms(goal: str) -> tuple[list[str], list[str]]:
    text = goal.replace("β", "beta").replace("α", "alpha").replace("γ", "gamma")
    raw_terms = re.findall(r"[a-zA-Z][a-zA-Z0-9\-\+\.]+", text)
    stop_words = {
        "the", "a", "an", "in", "of", "for", "to", "and", "or", "with",
        "role", "effect", "function", "mechanism", "study", "analysis",
        "research", "gene", "genes", "mutation", "mutations", "variant",
        "variants", "protein", "pathway",
    }
    core_terms = [term for term in raw_terms if term.lower() not in stop_words and len(term) > 1]
    gene_terms = [term for term in core_terms if term.isupper() and 2 <= len(term) <= 12]
    topic_terms = [term for term in core_terms if term not in gene_terms]
    return gene_terms[:3], topic_terms[:5]


def is_relevant_paper(paper: Paper, goal: str, strict: bool = False) -> bool:
    """Keep papers that mention the core entities from the research goal."""
    gene_terms, topic_terms = _goal_terms(goal)
    searchable = " ".join([paper.title, paper.abstract, paper.journal]).lower()
    if not searchable.strip():
        return False

    if gene_terms and not any(term.lower() in searchable for term in gene_terms):
        return False
    if topic_terms and not any(term.lower() in searchable for term in topic_terms):
        return False
    if strict and gene_terms and topic_terms:
        return any(term.lower() in paper.title.lower() for term in gene_terms) and any(
            term.lower() in searchable for term in topic_terms
        )
    return True


def search_pubmed(query: str, limit: int = 8) -> list[Paper]:
    """Search PubMed through NCBI E-utilities and return real PMID-backed papers."""
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    encoded = urllib.parse.urlencode({
        "db": "pubmed",
        "term": query,
        "retmode": "json",
        "retmax": str(limit),
        "sort": "relevance",
    })
    search = _get_json(f"{base}/esearch.fcgi?{encoded}")
    pmids = search.get("esearchresult", {}).get("idlist", [])
    if not pmids:
        return []

    summary_q = urllib.parse.urlencode({
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "json",
    })
    summary = _get_json(f"{base}/esummary.fcgi?{summary_q}")
    result = summary.get("result", {})
    papers: list[Paper] = []
    for pmid in pmids:
        item = result.get(pmid, {})
        if not item:
            continue
        article_ids = item.get("articleids", [])
        doi = ""
        for article_id in article_ids:
            if article_id.get("idtype") == "doi":
                doi = article_id.get("value", "")
                break
        authors = ", ".join(author.get("name", "") for author in item.get("authors", [])[:6] if author.get("name"))
        papers.append(Paper(
            title=item.get("title", "").rstrip("."),
            authors=authors,
            year=(item.get("pubdate", "")[:4] if item.get("pubdate") else ""),
            journal=item.get("fulljournalname", "") or item.get("source", ""),
            doi=doi,
            pmid=pmid,
            source="pubmed",
            url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        ))
    return papers


def search_crossref(query: str, limit: int = 8) -> list[Paper]:
    """Search CrossRef as an independent DOI-backed fallback/source."""
    params = urllib.parse.urlencode({
        "query": query,
        "rows": str(limit),
        "select": "title,author,published-print,published-online,container-title,DOI,URL",
    })
    data = _get_json(f"https://api.crossref.org/works?{params}")
    items = data.get("message", {}).get("items", [])
    papers: list[Paper] = []
    for item in items:
        title = " ".join(item.get("title", [])[:1]).strip()
        if not title:
            continue
        published = item.get("published-print") or item.get("published-online") or {}
        date_parts = published.get("date-parts", [[]])
        year = str(date_parts[0][0]) if date_parts and date_parts[0] else ""
        author_names = []
        for author in item.get("author", [])[:6]:
            name = " ".join(part for part in [author.get("given", ""), author.get("family", "")] if part)
            if name:
                author_names.append(name)
        papers.append(Paper(
            title=title,
            authors=", ".join(author_names),
            year=year,
            journal=" ".join(item.get("container-title", [])[:1]),
            doi=item.get("DOI", ""),
            source="crossref",
            url=item.get("URL", ""),
        ))
    return papers


def search_europe_pmc(query: str, limit: int = 8) -> list[Paper]:
    """Search Europe PMC for PMID/DOI-backed biomedical literature."""
    params = urllib.parse.urlencode({
        "query": query,
        "format": "json",
        "pageSize": str(limit),
        "resultType": "core",
    })
    data = _get_json(f"https://www.ebi.ac.uk/europepmc/webservices/rest/search?{params}")
    items = data.get("resultList", {}).get("result", [])
    papers: list[Paper] = []
    for item in items:
        title = item.get("title", "")
        if not title:
            continue
        papers.append(Paper(
            title=title.rstrip("."),
            authors=item.get("authorString", ""),
            year=item.get("pubYear", ""),
            journal=item.get("journalTitle", ""),
            doi=item.get("doi", ""),
            pmid=item.get("pmid", ""),
            abstract=item.get("abstractText", ""),
            source="europe_pmc",
            url=item.get("fullTextUrlList", {}).get("fullTextUrl", [{}])[0].get("url", "")
            if item.get("fullTextUrlList", {}).get("fullTextUrl") else (
                f"https://europepmc.org/article/MED/{item.get('pmid')}" if item.get("pmid") else ""
            ),
        ))
    return papers


def search_pubmed_browser(query: str, limit: int = 8) -> list[Paper]:
    """Search PubMed with a local browser and extract visible result cards.

    This backend is useful when API TLS/proxy behavior is unreliable but normal
    browser navigation still works on the same machine.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Browser search requires `pip install playwright`.") from exc

    url = "https://pubmed.ncbi.nlm.nih.gov/?" + urllib.parse.urlencode({"term": query})
    papers: list[Paper] = []
    with sync_playwright() as playwright:
        launch_kwargs: dict[str, Any] = {"headless": True}
        if os.path.exists(CHROME_APP_PATH):
            launch_kwargs["executable_path"] = CHROME_APP_PATH
        browser = playwright.chromium.launch(**launch_kwargs)
        try:
            page = browser.new_page(user_agent=USER_AGENT)
            page.goto(url, wait_until="domcontentloaded", timeout=BROWSER_TIMEOUT_MS)
            page.wait_for_timeout(1200)

            results = page.locator(".docsum-content").all()
            for result in results[:limit]:
                title = result.locator(".docsum-title").inner_text(timeout=3000).strip()
                title = re.sub(r"\s+", " ", title)
                href = result.locator(".docsum-title").get_attribute("href") or ""
                pmid_match = re.search(r"/(\d{6,9})/?", href)
                pmid = pmid_match.group(1) if pmid_match else ""
                journal = ""
                year = ""
                try:
                    citation = result.locator(".docsum-journal-citation").inner_text(timeout=1000)
                    journal = citation.strip()
                    year_match = re.search(r"\b(19|20)\d{2}\b", citation)
                    year = year_match.group(0) if year_match else ""
                except Exception:
                    pass
                papers.append(Paper(
                    title=title.rstrip("."),
                    year=year,
                    journal=journal,
                    pmid=pmid,
                    source="pubmed_browser",
                    url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else urllib.parse.urljoin(url, href),
                ))
        finally:
            browser.close()
    return papers


def search_geo(query: str, limit: int = 6) -> list[GeoDataset]:
    """Search NCBI GEO DataSets through E-utilities."""
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    search_q = urllib.parse.urlencode({
        "db": "gds",
        "term": query,
        "retmode": "json",
        "retmax": str(limit),
        "sort": "relevance",
    })
    search = _get_json(f"{base}/esearch.fcgi?{search_q}")
    ids = search.get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []
    summary_q = urllib.parse.urlencode({
        "db": "gds",
        "id": ",".join(ids),
        "retmode": "json",
    })
    summary = _get_json(f"{base}/esummary.fcgi?{summary_q}")
    result = summary.get("result", {})
    datasets: list[GeoDataset] = []
    for uid in ids:
        item = result.get(uid, {})
        if not item:
            continue
        accession = item.get("accession", "")
        if accession and not re.match(r"^(GSE|GDS)\d+", accession, re.IGNORECASE):
            continue
        datasets.append(GeoDataset(
            accession=accession,
            title=item.get("title", ""),
            organism=item.get("taxon", ""),
            type=item.get("gdstype", ""),
            samples=str(item.get("n_samples", "") or ""),
            url=f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accession}" if accession else "",
        ))
    return datasets


def search_research_context(
    goal: str,
    keywords: list[str],
    paper_limit: int = 12,
    dataset_limit: int = 6,
    search_mode: str = "auto",
    search_backend: str = "api",
    trusted_references: str = "",
) -> ResearchContext:
    """Fetch real web search context before the agents start discussing."""
    context = ResearchContext(trusted_references=trusted_references)
    if search_mode == "off":
        context.errors.append("Network search disabled by --search-mode off.")
        return context

    queries: list[str] = []
    seen_queries: set[str] = set()
    for query in [goal, *keywords]:
        key = query.lower().replace(" ", "")
        if key in seen_queries:
            continue
        seen_queries.add(key)
        queries.append(query)
        if len(queries) >= MAX_SEARCH_QUERIES:
            break
    queries = queries or [goal]
    paper_candidates: list[Paper] = []
    search_jobs: list[tuple[str, str, Any, int]] = []
    for query in queries:
        per_query_limit = max(3, paper_limit // len(queries))
        if search_backend in {"browser", "hybrid"}:
            search_jobs.append(("Browser PubMed", query, search_pubmed_browser, per_query_limit))
        if search_backend in {"api", "hybrid"}:
            search_jobs.append(("PubMed", query, search_pubmed, per_query_limit))
            search_jobs.append(("Europe PMC", query, search_europe_pmc, per_query_limit))
            if search_mode != "strict":
                search_jobs.append(("CrossRef", query, search_crossref, per_query_limit))

    max_workers = max(1, min(8, len(search_jobs)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(func, query, limit): (source, query)
            for source, query, func, limit in search_jobs
        }
        for future in as_completed(future_map):
            source, query = future_map[future]
            try:
                paper_candidates.extend(future.result())
            except Exception as exc:
                context.errors.append(f"{source} search failed for `{query}`: {exc}")

    if search_mode == "strict" and len(paper_candidates) < paper_limit and search_backend in {"api", "hybrid"}:
        with ThreadPoolExecutor(max_workers=max(1, min(4, len(queries)))) as executor:
            future_map = {
                executor.submit(search_crossref, query, max(3, paper_limit // len(queries))): query
                for query in queries
            }
            for future in as_completed(future_map):
                query = future_map[future]
                try:
                    paper_candidates.extend(future.result())
                except Exception as exc:
                    context.errors.append(f"CrossRef search failed for `{query}`: {exc}")

    strict_filter = search_mode == "strict"
    filtered = [paper for paper in paper_candidates if is_relevant_paper(paper, goal, strict=strict_filter)]
    context.excluded_papers = max(0, len(paper_candidates) - len(filtered))
    context.papers = _deduplicate_papers(filtered, paper_limit)

    dataset_query = goal
    try:
        context.datasets = search_geo(dataset_query, limit=dataset_limit)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        context.errors.append(f"GEO search failed for `{dataset_query}`: {exc}")
    return context


# ───────────── Keyword generation ─────────────


def generate_keywords(goal: str) -> list[str]:
    """Generate PubMed-friendly search queries from a research goal."""
    text = goal.strip()
    text = text.replace("β", "beta").replace("α", "alpha").replace("γ", "gamma")
    text = text.replace("δ", "delta").replace("κB", "kappa B")

    english_tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9\-\+\.]+", text)
    stop_words = {
        "the", "a", "an", "in", "of", "for", "to", "and", "or", "is", "are",
        "was", "were", "be", "been", "has", "have", "had", "do", "does", "did",
        "role", "effect", "function", "mechanism", "study", "analysis",
        "research", "investigation", "using", "based", "with", "from",
        "that", "this", "these", "those", "its", "their", "our",
        "gene", "genes", "mutation", "mutations", "variant", "variants",
    }
    significant = [t for t in english_tokens if t.lower() not in stop_words and len(t) > 1]

    if not significant:
        return [text]

    queries = []
    # 1. Direct join
    queries.append(" AND ".join(significant[:8]))
    # 2. First 2-3 key terms
    if len(significant) >= 3:
        queries.append(f'({significant[0]} AND {significant[1]} AND {significant[2]})')
        queries.append(f'({significant[0]} AND {significant[1]})')
    # 3. Gene + disease pattern
    gene_candidates = [t for t in significant if t.isupper() and len(t) <= 10]
    if gene_candidates:
        disease_terms = [t for t in significant if t.lower() not in {g.lower() for g in gene_candidates}][:3]
        if disease_terms:
            gene = gene_candidates[0]
            disease_q = " OR ".join(disease_terms)
            queries.append(f'("{gene}" OR "{gene} gene" OR "{gene} mutation") AND ({disease_q})')
    # 4. Broader fallback
    if len(significant) > 4:
        queries.append("(" + " OR ".join(significant[:4]) + ")")

    seen = set()
    unique = []
    for q in queries:
        key = q.lower().replace(" ", "")
        if key not in seen:
            seen.add(key)
            unique.append(q)
        if len(unique) >= 5:
            break
    return unique or [text]


# ───────────── Reference extraction ─────────────


def extract_references(text: str) -> list[Paper]:
    """Extract paper references from an agent's text output.

    Matches patterns like:
      - DOI: 10.xxxx/xxxx
      - PMID: xxxxxx
      - URLs with doi.org
      - Markdown reference list sections
    """
    papers: dict[str, Paper] = {}

    # Pattern 1: DOI references
    doi_pattern = re.compile(r'(?:DOI|doi)[:\s]*((?:10\.\d{4,}/[^\s,;)\]]+))')
    for match in doi_pattern.finditer(text):
        doi = match.group(1).rstrip(".,;")
        if doi not in papers:
            papers[doi] = Paper(doi=doi, source="extracted")

    # Pattern 2: PMID references
    pmid_pattern = re.compile(r'(?:PMID|pmid)[:\s]*(\d{6,9})')
    for match in pmid_pattern.finditer(text):
        pmid = match.group(1)
        if not any(p.pmid == pmid for p in papers.values()):
            p = next((p for p in papers.values() if p.pmid == pmid), None)
            if not p:
                papers[f"pmid:{pmid}"] = Paper(pmid=pmid, source="extracted")

    # Pattern 3: doi.org URLs
    url_pattern = re.compile(r'(?:https?://)?(?:dx\.)?doi\.org/((?:10\.\d{4,}/[^\s,;)\]]+))')
    for match in url_pattern.finditer(text):
        doi = match.group(1).rstrip(".,;")
        if doi not in papers:
            papers[doi] = Paper(doi=doi, source="extracted")

    # Pattern 4: Reference list lines with "Title (Year)" pattern
    ref_lines = []
    in_refs = False
    for line in text.split("\n"):
        stripped = line.strip()
        if re.match(r'^#{1,3}\s*(?:参考|引用|Reference)', stripped, re.IGNORECASE):
            in_refs = True
            continue
        if in_refs:
            if re.match(r'^#{1,3}\s', stripped) and not re.match(r'^#{1,3}\s*(?:参考|引用|Reference)', stripped, re.IGNORECASE):
                break
            if stripped and not stripped.startswith("#"):
                ref_lines.append(stripped)

    for line in ref_lines:
        # Try to extract title + year + journal from reference lines
        title_match = re.search(r'\*\*(.+?)\*\*', line)
        year_match = re.search(r'\((\d{4})\)', line)
        if title_match and year_match:
            title = title_match.group(1).strip()
            year = year_match.group(1)
            # Check if this is a duplicate
            if not any(p.title == title for p in papers.values()):
                journal = ""
                j_match = re.search(r'\*(.+?)\*', line)
                if j_match:
                    journal = j_match.group(1).strip()
                pmid_m = re.search(r'PMID:\s*(\d{6,9})', line)
                pmid = pmid_m.group(1) if pmid_m else ""
                doi_m = re.search(r'DOI:\s*((?:10\.\d{4,}/[^\s,;)\]]+))', line)
                doi = doi_m.group(1).rstrip(".,;") if doi_m else ""
                key = doi or pmid or title[:40]
                papers[key] = Paper(
                    title=title,
                    year=year,
                    journal=journal,
                    doi=doi,
                    pmid=pmid,
                    source="extracted",
                )

    return list(papers.values())


def build_search_instruction(keywords: list[str]) -> str:
    """Build the search instruction block for the literature agent."""

    kw_lines = "\n".join(f"  - `{kw}`" for kw in keywords)

    return f"""
## ⚠️ CRITICAL RULE: DO NOT INVENT PAPERS

You MUST base your literature review ONLY on real papers obtained through
your MCP paper-search tools (search_pubmed, search_crossref, etc.).
Do NOT make up papers, citations, DOIs, or PMIDs. If you cannot find
relevant papers on a subtopic, say "No papers found" — do not fabricate.

## Suggested Search Queries

The following queries were auto-generated from the research goal.
Use your `search_pubmed` and `search_crossref` tools to find real papers:

{kw_lines}

## Your Task

1. Search for papers using the tools available to you
2. Read the abstracts and determine relevance
3. Write a structured literature review based ONLY on real papers you found
4. For each paper include: title, authors, year, journal, DOI, PMID
5. End with a complete reference list
"""
