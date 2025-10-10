import Parser from "rss-parser";
import { Feed } from "feed";
import fs from "fs";

const parser = new Parser({
  headers: { "User-Agent": "Finance-RSS/1.0" },
  timeout: 10000,
});

const FEED_SOURCES = [
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
  { name: "FT Chinese", url: "http://www.ftchinese.com/rss/news" },
  { name: "财新网", url: "https://weekly.caixin.com/rss/" },
  { name: "华尔街见闻", url: "https://wallstreetcn.com/rss" }
];

// 工具函数：抓取所有RSS源
async function fetchAllFeeds() {
  const allItems = [];

  for (const src of FEED_SOURCES) {
    try {
      console.log(`Fetching feed: ${src.name}`);
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
      console.error(`❌ Failed to fetch ${src.name}:`, e.message);
    }
  }

  return allItems;
}

// 主函数
async function main() {
  console.log("🚀 Fetching finance feeds...");
  const items = await fetchAllFeeds();

  // 去重 + 排序
  const seen = new Set();
  const sorted = items
    .filter(i => {
      if (seen.has(i.link)) return false;
      seen.add(i.link);
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 50);

  console.log(`✅ Collected ${sorted.length} articles.`);

  // 生成RSS
  const feed = new Feed({
    title: "Finance News Summary",
    description: "Merged global finance news feed",
    id: "https://finance-rss.example.com/",
    link: "https://finance-rss.example.com/",
    language: "en",
    favicon: "https://www.cnbc.com/favicon.ico",
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
  fs.writeFileSync("finance_feed.xml", xml);
  console.log("📰 RSS feed generated: finance_feed.xml");
}

main().catch(e => console.error(e));
