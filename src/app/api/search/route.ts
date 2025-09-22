import { NextResponse } from 'next/server';
import { api_config } from '@/config/api';
import { parseStringPromise } from 'xml2js';

// 定义每个API请求的超时时间（毫秒）
const FETCH_TIMEOUT = 5000; // 5秒

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Search query not provided' }, { status: 400 });
  }

  // --- 修改开始 ---
  // 1. 创建一个 promises 数组来存放所有API的请求
  const promises = Object.entries(api_config.api_site).map(async ([key, site]) => {
    const url = `${site.api}?wd=${encodeURIComponent(q)}`;
    
    // 2. 为每个 fetch 请求创建一个 AbortController 来控制超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal, // 关联 AbortController
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
        }
      });

      // 清除超时定时器，因为请求已经成功返回
      clearTimeout(timeoutId);

      if (!response.ok) {
        // 如果HTTP响应状态不是2xx，则视为失败
        console.error(`Error fetching from ${site.name}: Status ${response.status}`);
        return []; // 返回空数组表示此源失败
      }
      
      const xmlText = await response.text();
      const parsed = await parseStringPromise(xmlText, { explicitArray: false, ignoreAttrs: true });
      
      if (!parsed.rss || !parsed.rss.list || !parsed.rss.list.video) {
        return [];
      }
      
      let videos = Array.isArray(parsed.rss.list.video) ? parsed.rss.list.video : [parsed.rss.list.video];
      
      // 为每个视频结果添加来源信息
      return videos.map((video: any) => ({ ...video, source: key, source_name: site.name }));

    } catch (error: any) {
      // 清除超时定时器，以防万一
      clearTimeout(timeoutId);

      // 捕获 fetch 错误（包括超时），并记录下来
      if (error.name === 'AbortError') {
        console.log(`Request to ${site.name} timed out.`);
      } else {
        console.error(`Error processing ${site.name}:`, error.message);
      }
      return []; // 对失败的源返回空数组，不影响其他结果
    }
  });

  // 3. 使用 Promise.allSettled 来执行所有请求
  //    - allSettled 会等待所有 promise 完成，无论成功或失败
  //    - 这确保了单个API的失败不会中断整个搜索过程
  const settledResults = await Promise.allSettled(promises);

  // 4. 从 settled 结果中提取所有成功的数据并合并
  const results = settledResults
    .filter(result => result.status === 'fulfilled' && result.value)
    .flatMap(result => (result as PromiseFulfilledResult<any[]>).value);
  // --- 修改结束 ---

  return NextResponse.json({ data: results });
}
