// note.com の記事を取得して、ブログ一覧ページと個別記事ページを自動生成する。
// GitHub Actions から定期実行される想定 (.github/workflows/update-blog.yml)。
// 生成物 (blog/index.html, blog/posts/*.html) は手動編集せず、常にこのスクリプトから再生成すること。

import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NOTE_USER = "kuma_hitode";
const RSS_URL = `https://note.com/${NOTE_USER}/rss`;
const NOTE_PROFILE_URL = `https://note.com/${NOTE_USER}`;

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BLOG_DIR = join(ROOT_DIR, "blog");
const POSTS_DIR = join(BLOG_DIR, "posts");

const THEME = {
  bg: "#0d0f14",
  cardBg: "#161a22",
  textMain: "#eef1f6",
  textSub: "#9aa4b2",
  accent: "#6ea8fe",
  border: "#262c38",
};

async function fetchRss() {
  const res = await fetch(RSS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; blog-sync-bot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`note RSS の取得に失敗しました: ${res.status}`);
  }
  return res.text();
}

function matchAll(regex, str) {
  return [...str.matchAll(regex)];
}

function extractTag(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function extractCdata(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function slugFromLink(link) {
  const m = link.match(/\/n\/([a-zA-Z0-9]+)\/?$/);
  if (m) return m[1];
  return link.replace(/[^a-zA-Z0-9]/g, "").slice(-32) || "post";
}

function cleanExcerptHtml(rawHtml) {
  // note の RSS 本文末尾についてくる「続きをみる」リンクは、自前の CTA ボタンに置き換えるため除去する
  return rawHtml.replace(/<br\s*\/?>\s*<a\s+href=['"][^'"]*['"]>続きをみる<\/a>\s*$/i, "").trim();
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function formatDate(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return pubDate;
  return d.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function parseItems(rssXml) {
  const itemBlocks = matchAll(/<item>([\s\S]*?)<\/item>/g, rssXml).map((m) => m[1]);

  return itemBlocks.map((xml) => {
    const title = extractTag(xml, "title");
    const link = extractTag(xml, "link");
    const pubDate = extractTag(xml, "pubDate");
    const thumbnail = extractTag(xml, "media:thumbnail");
    const excerptHtml = cleanExcerptHtml(extractCdata(xml, "description"));

    return {
      title,
      link,
      pubDate,
      dateLabel: formatDate(pubDate),
      thumbnail,
      excerptHtml,
      excerptText: truncate(stripTags(excerptHtml), 90),
      slug: slugFromLink(link),
    };
  });
}

function pageShell({ title, description, bodyHtml, depth }) {
  const prefix = "../".repeat(depth);
  return `<!DOCTYPE html>
<!-- このファイルは scripts/generate-blog.mjs によって自動生成されます。直接編集しないでください。 -->
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<style>
  :root {
    --bg: ${THEME.bg};
    --card-bg: ${THEME.cardBg};
    --text-main: ${THEME.textMain};
    --text-sub: ${THEME.textSub};
    --accent: ${THEME.accent};
    --border: ${THEME.border};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text-main);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN",
      "Hiragino Sans", Meiryo, sans-serif;
    padding: 24px;
    display: flex;
    justify-content: center;
  }
  .wrap {
    width: 100%;
    max-width: 640px;
    padding: 16px 0 48px;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-sub);
    text-decoration: none;
    font-size: 14px;
    margin-bottom: 24px;
    opacity: 0;
    animation: fadeIn 0.6s ease forwards;
  }
  .back-link:hover { color: var(--accent); }
  .page-title {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 28px;
    opacity: 0;
    animation: fadeIn 0.6s ease 0.1s forwards;
  }
  .post-card {
    display: block;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    text-decoration: none;
    color: var(--text-main);
    margin-bottom: 16px;
    transition: transform 0.2s ease, border-color 0.2s ease;
    opacity: 0;
    animation: fadeInUp 0.6s ease forwards;
  }
  .post-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
  }
  .post-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 10px;
    margin-bottom: 14px;
    display: block;
    background: var(--border);
  }
  .post-date {
    font-size: 12.5px;
    color: var(--text-sub);
    margin-bottom: 6px;
  }
  .post-title {
    font-size: 17px;
    font-weight: 700;
    line-height: 1.5;
    margin-bottom: 8px;
  }
  .post-excerpt {
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--text-sub);
  }
  .empty-state {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 32px 24px;
    text-align: center;
    color: var(--text-sub);
    font-size: 14px;
    line-height: 1.8;
  }
  .empty-state a { color: var(--accent); }

  .article-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 16px;
    margin-bottom: 24px;
    opacity: 0;
    animation: fadeIn 0.6s ease 0.15s forwards;
  }
  .article-date {
    font-size: 13px;
    color: var(--text-sub);
    margin-bottom: 8px;
    opacity: 0;
    animation: fadeIn 0.6s ease 0.2s forwards;
  }
  .article-title {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.5;
    margin-bottom: 24px;
    opacity: 0;
    animation: fadeIn 0.6s ease 0.25s forwards;
  }
  .article-body {
    font-size: 15px;
    line-height: 1.9;
    color: var(--text-main);
    margin-bottom: 32px;
    opacity: 0;
    animation: fadeIn 0.6s ease 0.35s forwards;
  }
  .article-body p { margin-bottom: 1em; }
  .article-body img { max-width: 100%; border-radius: 8px; }
  .read-more-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 28px;
    border-radius: 999px;
    background: var(--accent);
    color: #0d0f14;
    text-decoration: none;
    font-size: 14.5px;
    font-weight: 600;
    transition: opacity 0.2s ease;
    opacity: 0;
    animation: fadeIn 0.6s ease 0.45s forwards;
  }
  .read-more-btn:hover { opacity: 0.85; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (max-width: 480px) {
    body { padding: 16px; }
    .page-title { font-size: 21px; }
    .article-title { font-size: 20px; }
  }
</style>
</head>
<body>
  <div class="wrap">
${bodyHtml}
  </div>
</body>
</html>
`;
}

function renderListPage(posts) {
  const cards = posts
    .map(
      (post, i) => `    <a class="post-card" href="posts/${post.slug}.html" style="animation-delay:${0.15 + i * 0.08}s">
      ${post.thumbnail ? `<img class="post-thumb" src="${post.thumbnail}" alt="" loading="lazy">` : ""}
      <div class="post-date">${post.dateLabel}</div>
      <div class="post-title">${post.title}</div>
      <div class="post-excerpt">${post.excerptText}</div>
    </a>`
    )
    .join("\n");

  const body = posts.length
    ? cards
    : `    <div class="empty-state">まだ記事がありません。<br>近日公開予定です。<a href="${NOTE_PROFILE_URL}" target="_blank" rel="noopener noreferrer">note</a> もあわせてご覧ください。</div>`;

  return pageShell({
    title: "ブログ | クマガイ",
    description: "クマガイのnote記事一覧です。",
    depth: 0,
    bodyHtml: `    <a class="back-link" href="../index.html">← トップに戻る</a>
    <div class="page-title">ブログ</div>
${body}`,
  });
}

function renderPostPage(post) {
  return pageShell({
    title: `${post.title} | クマガイ`,
    description: post.excerptText,
    depth: 1,
    bodyHtml: `    <a class="back-link" href="../index.html">← 記事一覧に戻る</a>
    ${post.thumbnail ? `<img class="article-thumb" src="${post.thumbnail}" alt="">` : ""}
    <div class="article-date">${post.dateLabel}</div>
    <div class="article-title">${post.title}</div>
    <div class="article-body">${post.excerptHtml}</div>
    <a class="read-more-btn" href="${post.link}" target="_blank" rel="noopener noreferrer">noteで全文を読む →</a>`,
  });
}

async function main() {
  const rssXml = await fetchRss();
  const posts = parseItems(rssXml);

  mkdirSync(POSTS_DIR, { recursive: true });

  // 前回生成分をクリアしてから作り直す (note 側で削除された記事のページが残らないように)
  if (existsSync(POSTS_DIR)) {
    for (const file of readdirSync(POSTS_DIR)) {
      rmSync(join(POSTS_DIR, file));
    }
  }

  for (const post of posts) {
    writeFileSync(join(POSTS_DIR, `${post.slug}.html`), renderPostPage(post));
  }
  writeFileSync(join(BLOG_DIR, "index.html"), renderListPage(posts));

  console.log(`Generated ${posts.length} post page(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
