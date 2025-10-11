import axios from 'axios';

export async function translateText(text, targetLanguage = 'zh-CN') {
  if (!text) return text;
  
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(text)}`;
  
  try {
    const response = await axios.get(url);
    if (response.data && response.data[0]) {
      return response.data[0].map(item => item[0]).join(' ');
    }
    return text;
  } catch (error) {
    console.warn(`Translation failed for text: ${text.substring(0, 50)}...`);
    return text; // 返回原文本如果翻译失败
  }
}