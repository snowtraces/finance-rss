import Parser from "rss-parser";
import { Feed } from "feed";
import fs from "fs";

const parser = new Parser({
  headers: { "User-Agent": "Finance-RSS/1.0" },
  timeout: 10000,
});

const FEED_SOURCES = [
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "Reuters Business", url: "https://news.google.com/rss/search?q=site:reuters.com&hl=en-US&gl=US&ceid=US:en" },
  { name: "FT Chinese", url: "http://www.ftchinese.com/rss/news" },
  { name: "财新网", url: "https://news.google.com/rss/search?q=site:finance.caixin.com&hl=zh-CN&gl=CN&ceid=CN:zh-Hans" },
  { name: "华尔街见闻", url: "https://news.google.com/rss/search?q=site:wallstreetcn.com&hl=zh-CN&gl=CN&ceid=CN:zh-Hans" }
];

async function fetchAllFeeds() {
  const allItems = [];
  for (const src of FEED_SOURCES) {
    try {
      console.log(`📡 Fetching: ${src.name}`);
      const feed = await parser.parseURL(src.url);
      feed.items.forEach(item => {
        allItems.push({
          title: item.title,
          link: item.link,
          date: item.isoDate || item.pubDate || new Date().toISOString(),
          source: src.name,
          content: item.contentSnippet || item.content || ""
        });
      });
    } catch (e) {
      console.error(`❌ ${src.name} fetch failed: ${e.message}`);
    }
  }
  return allItems;
}

async function main() {
  console.log("🚀 Fetching finance RSS feeds...");
  const items = await fetchAllFeeds();

  const seen = new Set();
  const sorted = items
    .filter(i => {
      if (seen.has(i.link)) return false;
      seen.add(i.link);
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 100);

  console.log(`✅ Collected ${sorted.length} articles.`);

  const feed = new Feed({
    title: "Finance News Summary",
    description: "Merged global finance news feed",
    id: "https://yourname.github.io/finance-rss/",
    link: "https://yourname.github.io/finance-rss/",
    language: "en",
    updated: new Date(),
    generator: "Finance-RSS Generator"
  });

  sorted.forEach(item => {
    feed.addItem({
      title: item.title,
      id: item.link,
      link: item.link,
      date: new Date(item.date),
      description: `[${item.source}] ${item.content}`
    });
  });

  const xml = feed.rss2();
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/finance_feed.xml", xml);

  console.log("📰 Generated: dist/finance_feed.xml");
  fs.copyFileSync('template/index.html', 'dist/index.html');
}

main().catch(console.error);
