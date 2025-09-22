import { NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';
import runtime from '@/lib/runtime';

// 1. 增加超时时间，给 API 更多响应时间
const FETCH_TIMEOUT = 8000; // 从 3000 增加到 8000 (8秒)
const MAX_CONCURRENT = 8;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Search query not provided' }, { status: 400 });
  }

  if (!runtime?.api_site) {
    return NextResponse.json({ error: 'API configuration not found' }, { status: 500 });
  }

  const apiEntries = Object.entries(runtime.api_site).slice(0, MAX_CONCURRENT);
  
  const promises = apiEntries.map(async ([key, site]: [string, any]) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(`${site.api}?wd=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      clearTimeout(timeoutId);
      if (!response.ok) return [];
      
      const xmlText = await response.text();
      
      // 2. 增加健壮性：确保只解析有效的 XML
      let parsed;
      try {
        parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: true });
      } catch (parseError) {
        console.error(`XML parsing error for ${key}:`, parseError);
        return []; // 如果解析失败，返回空数组
      }
      
      if (!parsed.rss?.list?.video) return [];
      
      const videos = Array.isArray(parsed.rss.list.video) 
        ? parsed.rss.list.video 
        : [parsed.rss.list.video];
      
      return videos.slice(0, 15).map((video: any) => ({ 
        ...video, 
        source: key, 
        source_name: site.name 
      }));

    } catch (error) {
      clearTimeout(timeoutId);
      // 只记录错误，不影响其他请求
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`Request to ${key} timed out.`);
      } else {
        console.error(`Fetch error for ${key}:`, error);
      }
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  const data = results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => (result as PromiseFulfilledResult<any[]>).value);

  return NextResponse.json({ data });
}