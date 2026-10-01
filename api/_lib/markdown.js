// Tiny, safe Markdown → HTML for blog posts. Raw HTML is always escaped.
// Supports: ## / ### headings, paragraphs, - and 1. lists, > quotes, ---,
// **bold**, *italic*, `code`, [links](https://…), ![photos](https://…),
// and simple | tables |.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeUrl(u) {
    const url = String(u || '').trim();
    if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) || /^#/.test(url) || /^mailto:/i.test(url)) return url;
    if (/^[a-z0-9-]+(\.html)?([?#].*)?$/i.test(url)) return '/' + url;
    return null;
}

export function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

function inline(text) {
    // escape first, then add formatting
    let s = esc(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
        const u = safeUrl(url.replace(/&amp;/g, '&'));
        return u ? `<img src="${esc(u)}" alt="${alt}" loading="lazy">` : m;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
        const u = safeUrl(url.replace(/&amp;/g, '&'));
        if (!u) return m;
        const ext = /^https?:\/\//i.test(u) && !/jenzythrifts\.com/i.test(u);
        return `<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
    return s;
}

export function renderMarkdown(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const out = [];
    let i = 0;
    const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        let m;
        if ((m = line.match(/^(#{2,4})\s+(.+)$/))) {
            const lvl = m[1].length;
            out.push(`<h${lvl} id="${slugify(m[2])}">${inline(m[2].trim())}</h${lvl}>`);
            i++; continue;
        }
        if (/^#\s+/.test(line)) { out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`); i++; continue; }
        if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
        if (/^\s*>/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
            out.push(`<blockquote><p>${buf.map(inline).join('<br>')}</p></blockquote>`);
            continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
            out.push(`<ul>${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ul>`);
            continue;
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
            out.push(`<ol>${buf.map(b => `<li>${inline(b)}</li>`).join('')}</ol>`);
            continue;
        }
        if (isTableRow(line)) {
            const rows = [];
            while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
            const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
            const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
            const [head, ...rest] = body;
            out.push(`<div class="table-scroll"><table><thead><tr>${cells(head).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
            continue;
        }
        const buf = [];
        while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*]\s+|\s*\d+[.)]\s+|\s*>|\s*\|)/.test(lines[i]) && !/^\s*(---|\*\*\*)\s*$/.test(lines[i])) buf.push(lines[i++]);
        if (!buf.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
        out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('\n');
}

// Plain text (for descriptions and reading time)
export function plainText(src) {
    return String(src || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[#>\-*\d.)|\s]+/gm, '')
        .replace(/[*`|]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
export const readingMinutes = (src) => Math.max(1, Math.round(plainText(src).split(' ').length / 200));
