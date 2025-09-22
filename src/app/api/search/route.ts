import { NextResponse } from 'next/server';
import { parseStringPromise } from 'xml2js';
import runtime from '@/lib/runtime';

const FETCH_TIMEOUT = 3000;
const MAX_CONCURRENT = 8;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  console.log('🔍 Search API called with query:', q);

  if (!q) {
    return NextResponse.json({ error: 'Search query not provided' }, { status: 400 });
  }

  if (!runtime?.api_site) {
    console.log('❌ Runtime api_site not found');
    return NextResponse.json({ error: 'API configuration not found' }, { status: 500 });
  }

  console.log('📋 Available API sites:', Object.keys(runtime.api_site).length);
  
  const apiEntries = Object.entries(runtime.api_site).slice(0, MAX_CONCURRENT);
  console.log('🎯 Using API sites:', apiEntries.map(([key]) => key));
  
  const promises = apiEntries.map(async ([key, site]: [string, any]) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const apiUrl = `${site.api}?wd=${encodeURIComponent(q)}`;

    try {
      console.log(`🌐 Fetching from ${key}: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.log(`❌ ${key} failed with status:`, response.status);
        return [];
      }
      
      const xmlText = await response.text();
      console.log(`📄 ${key} response length:`, xmlText.length);
      
      if (xmlText.length < 100) {
        console.log(`⚠️ ${key} response too short:`, xmlText.substring(0, 200));
      }
      
      const parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: true });
      
      if (!parsed.rss?.list?.video) {
        console.log(`📭 ${key} no videos found in response structure`);
        return [];
      }
      
      const videos = Array.isArray(parsed.rss.list.video) 
        ? parsed.rss.list.video 
        : [parsed.rss.list.video];
      
      console.log(`✅ ${key} found ${videos.length} videos`);
      
      return videos.slice(0, 15).map((video: any) => ({ 
        ...video, 
        source: key, 
        source_name: site.name 
      }));

    } catch (error) {
      clearTimeout(timeoutId);
      console.log(`💥 ${key} error:`, error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  const data = results
    .filter(result => result.status === 'fulfilled')
    .flatMap(result => (result as PromiseFulfilledResult<any[]>).value);

  console.log('🎉 Total results found:', data.length);
  console.log('📊 Results summary:', data.slice(0, 3).map(item => ({ title: item.name, source: item.source })));

  return NextResponse.json({ data });
}