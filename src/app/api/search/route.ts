import { NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';

// 直接导入整个 runtime 模块
import runtime from '@/lib/runtime';

const FETCH_TIMEOUT = 3000;
const MAX_CONCURRENT = 8;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Search query not provided' }, { status: 400 });
  }

  // 使用 runtime.api_config 或 runtime.default.api_config
  const apiConfig = runtime?.api_config || runtime?.default?.api_config;
  
  if (!apiConfig) {
    return NextResponse.json({ error: 'API configuration not found' }, { status: 500 });
  }

  const apiEntries = Object.entries(apiConfig.api_site).slice(0, MAX_CONCURRENT);
  
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
      const parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: true });
      
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
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  const data = results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => (result as PromiseFulfilledResult<any[]>).value);

  return NextResponse.json({ data });
}