import Parser from "rss-parser";
import { Feed } from "feed";
import fs from "fs";
import { translateText } from "./translator.js"; // 添加导入

const parser = new Parser({
  headers: { 
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" 
  },
  timeout: 10000,
});

const FEED_SOURCES = [
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664" },
  { name: "Reuters Business", url: "https://news.google.com/rss/search?q=site:www.reuters.com/business&hl=en-US&gl=US&ceid=US:en" },
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

// 新增：翻译文章标题和内容的函数
async function translateItem(item) {
  // 检查是否需要翻译（基于来源或其他逻辑）
  const needsTranslation = ['CNBC', 'Reuters Business', 'FT Chinese'].includes(item.source);
  
  if (needsTranslation) {
    try {
      item.title = await translateText(item.title, 'zh-CN');
      item.content = await translateText(item.content, 'zh-CN');
    } catch (error) {
      console.warn(`Translation error for item from ${item.source}:`, error.message);
    }
  }
  
  return item;
}

async function main() {
  console.log("🚀 Fetching finance RSS feeds...");
  let items = await fetchAllFeeds();

  // 新增：翻译所有条目
  console.log("🌍 Translating English content...");
  items = await Promise.all(items.map(translateItem));

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